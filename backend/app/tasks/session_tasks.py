import logging
import os
import shutil

from sqlalchemy import or_, select, update

from app.database import get_sync_session
from app.models.duplicate import DuplicateFile
from app.models.sandbox import SandboxSession
from app.tasks.worker import huey

logger = logging.getLogger(__name__)


class CommitRollbackError(Exception):
    """Raised when rollback itself fails after a commit error."""


def _replay_commands(commands: list[dict], cursor: int) -> dict:
    """Replay active commands (commands[:cursor]) to compute net actions.

    Returns a dict with:
      - tagged_originals: set of directory paths to tag as original
      - marked_deletes: set of directory paths to delete
      - move_dests: dict mapping source_dir -> destination_dir
      - keepers: dict mapping group_id -> keeper_path
    """
    tagged_originals: set[str] = set()
    marked_deletes: set[str] = set()
    move_dests: dict[str, str] = {}
    keepers: dict[str, str] = {}

    for cmd in commands[:cursor]:
        cmd_type = cmd.get("type", "")
        path = cmd.get("path", "")
        group_id = cmd.get("group_id", "")

        if cmd_type == "tag-original":
            tagged_originals.add(path)
        elif cmd_type == "untag-original":
            tagged_originals.discard(path)

        elif cmd_type == "mark-delete":
            marked_deletes.add(path)
        elif cmd_type == "unmark-delete":
            marked_deletes.discard(path)

        elif cmd_type == "set-move-dest":
            dest = cmd.get("destination", "")
            if dest:
                move_dests[path] = dest
        elif cmd_type == "clear-move-dest":
            move_dests.pop(path, None)

        elif cmd_type in ("set-keeper", "accept-suggestion"):
            keeper_path = cmd.get("keeper_path", path)
            keepers[group_id] = keeper_path
        elif cmd_type == "clear-keeper":
            keepers.pop(group_id, None)

    return {
        "tagged_originals": tagged_originals,
        "marked_deletes": marked_deletes,
        "move_dests": move_dests,
        "keepers": keepers,
    }


def _rollback(completed_actions: list[dict]) -> None:
    """Reverse completed actions in LIFO order. Best-effort."""
    errors = []
    for action in reversed(completed_actions):
        action_type = action.get("type", "")
        try:
            if action_type == "mkdir":
                path = action["path"]
                if os.path.isdir(path) and not os.listdir(path):
                    os.rmdir(path)
                    logger.info("Rollback: removed directory %s", path)
                else:
                    logger.warning("Rollback: cannot rmdir %s (not empty or missing)", path)

            elif action_type == "move":
                src = action["src"]
                dest = action["dest"]
                shutil.move(dest, src)
                logger.info("Rollback: moved %s back to %s", dest, src)

            elif action_type in ("delete", "delete-file"):
                logger.warning(
                    "Rollback: cannot restore deleted %s at %s",
                    action_type, action.get("path", "unknown"),
                )

            elif action_type == "tag-originals":
                logger.warning(
                    "Rollback: DB tag-originals change needs manual fix for scan_id=%s",
                    action.get("scan_id", "unknown"),
                )
        except Exception as e:
            logger.error("Rollback failed for action %s: %s", action, e)
            errors.append((action, e))

    if errors:
        raise CommitRollbackError(
            f"Rollback encountered {len(errors)} error(s): "
            + "; ".join(str(e) for _, e in errors)
        )


@huey.task()
def commit_sandbox_session(session_id: int) -> dict:
    """Execute all sandbox commands atomically.

    Execution order (dependency-safe):
    1. Create destination directories (set-move-dest)
    2. Tag originals (tag-original) -- DB update
    3. Move originals to destinations (set-move-dest) -- shutil.move
    4. Delete marked directories (mark-delete) -- shutil.rmtree
    5. Apply keeper decisions (set-keeper/accept-suggestion) -- os.remove non-keepers
    """
    db = get_sync_session()
    completed_actions: list[dict] = []

    try:
        # Load the session
        result = db.execute(
            select(SandboxSession).where(SandboxSession.id == session_id)
        )
        session = result.scalars().first()
        if not session:
            logger.error("Sandbox session %d not found", session_id)
            return {"status": "failed", "error": "Session not found"}

        scan_id = session.scan_id
        actions = _replay_commands(session.commands or [], session.cursor)

        tagged_originals = actions["tagged_originals"]
        marked_deletes = actions["marked_deletes"]
        move_dests = actions["move_dests"]
        keepers = actions["keepers"]

        # --- Step 1: Create destination directories ---
        for dest_dir in set(move_dests.values()):
            if not os.path.exists(dest_dir):
                os.makedirs(dest_dir, exist_ok=True)
                completed_actions.append({"type": "mkdir", "path": dest_dir})
                logger.info("Created destination directory: %s", dest_dir)

        # --- Step 2: Tag originals (DB update) ---
        if tagged_originals:
            conditions = [
                DuplicateFile.path.startswith(d) for d in tagged_originals
            ]
            db.execute(
                update(DuplicateFile)
                .where(DuplicateFile.scan_id == scan_id)
                .where(or_(*conditions))
                .values(is_original=True)
            )
            db.commit()
            completed_actions.append({
                "type": "tag-originals",
                "scan_id": scan_id,
                "dirs": list(tagged_originals),
            })
            logger.info("Tagged originals for %d directories", len(tagged_originals))

        # --- Step 3: Move originals to destinations ---
        for src_dir, dest_dir in move_dests.items():
            if os.path.exists(src_dir):
                final_dest = os.path.join(dest_dir, os.path.basename(src_dir))
                shutil.move(src_dir, final_dest)
                completed_actions.append({
                    "type": "move",
                    "src": src_dir,
                    "dest": final_dest,
                })
                logger.info("Moved %s -> %s", src_dir, final_dest)

        # --- Step 4: Delete marked directories ---
        for dir_path in marked_deletes:
            if os.path.exists(dir_path):
                shutil.rmtree(dir_path)
                completed_actions.append({"type": "delete", "path": dir_path})
                logger.info("Deleted directory: %s", dir_path)

        # --- Step 5: Apply keeper decisions (delete non-keepers) ---
        for group_id, keeper_path in keepers.items():
            result = db.execute(
                select(DuplicateFile)
                .where(DuplicateFile.scan_id == scan_id)
                .where(DuplicateFile.group_id == group_id)
            )
            group_files = result.scalars().all()
            for f in group_files:
                if f.path != keeper_path and os.path.exists(f.path):
                    os.remove(f.path)
                    completed_actions.append({
                        "type": "delete-file",
                        "path": f.path,
                        "group_id": group_id,
                    })
                    logger.info("Deleted non-keeper: %s (group %s)", f.path, group_id)

        # --- Success: delete the session ---
        db.delete(session)
        db.commit()
        logger.info("Sandbox session %d committed successfully", session_id)
        return {"status": "completed"}

    except Exception as e:
        logger.error("Commit failed for session %d: %s", session_id, e)
        db.rollback()

        try:
            _rollback(completed_actions)
        except CommitRollbackError as rbe:
            logger.error("Partial rollback for session %d: %s", session_id, rbe)
            return {"status": "failed_partial", "error": str(rbe)}

        return {"status": "failed", "error": str(e)}

    finally:
        db.close()
