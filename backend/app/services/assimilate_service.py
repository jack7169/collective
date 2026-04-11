"""
Assimilate Duplicates service — manages staged file operations with
hash verification before commit. No changes are written to disk until
the user commits.
"""
import hashlib
import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assimilate import AssimilateSession
from app.models.duplicate import DuplicateFile

logger = logging.getLogger(__name__)


async def create_session(
    db: AsyncSession,
    scan_id: int,
    name: str,
    dir_a: str,
    dir_b: str,
) -> AssimilateSession:
    session = AssimilateSession(
        scan_id=scan_id,
        name=name,
        dir_a=dir_a,
        dir_b=dir_b,
        staged_operations=[],
        warnings_acknowledged=[],
    )
    db.add(session)
    await db.flush()
    return session


async def get_session(db: AsyncSession, session_id: int) -> Optional[AssimilateSession]:
    result = await db.execute(
        select(AssimilateSession).where(AssimilateSession.id == session_id)
    )
    return result.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    scan_id: Optional[int] = None,
    status: Optional[str] = None,
) -> list[AssimilateSession]:
    q = select(AssimilateSession).order_by(AssimilateSession.created_at.desc())
    if scan_id is not None:
        q = q.where(AssimilateSession.scan_id == scan_id)
    if status is not None:
        q = q.where(AssimilateSession.status == status)
    result = await db.execute(q)
    return list(result.scalars().all())


async def update_staged_ops(
    db: AsyncSession,
    session_id: int,
    operations: list[dict],
) -> AssimilateSession:
    sess = await get_session(db, session_id)
    if not sess:
        raise ValueError(f"Session {session_id} not found")
    if sess.status not in ("working", "previewing"):
        raise ValueError(f"Cannot modify session in '{sess.status}' state")
    sess.staged_operations = operations
    sess.status = "working"
    sess.preview_result = None
    return sess


async def preview_commit(
    db: AsyncSession,
    session_id: int,
) -> dict:
    """
    Compute what would happen if we commit. Returns:
    - operations: list of ops to execute
    - checksums_preserved: all checksums that will still exist after commit
    - checksums_lost: checksums that would be deleted with no copy remaining
    - warnings: list of files that would be lost
    """
    sess = await get_session(db, session_id)
    if not sess:
        raise ValueError(f"Session {session_id} not found")

    ops = sess.staged_operations or []
    dir_a = sess.dir_a
    dir_b = sess.dir_b

    # Get all known checksums from the scan for these directories
    q = select(DuplicateFile).where(
        DuplicateFile.scan_id == sess.scan_id,
        (DuplicateFile.path.startswith(dir_a + "/"))
        | (DuplicateFile.path.startswith(dir_b + "/")),
    )
    result = await db.execute(q)
    all_files = result.scalars().all()

    # Build checksum -> paths map
    checksum_paths: dict[str, set[str]] = {}
    for f in all_files:
        checksum_paths.setdefault(f.checksum, set()).add(f.path)

    # Simulate operations
    deleted_paths: set[str] = set()
    copied_paths: set[str] = set()

    for op in ops:
        op_type = op.get("type")
        source = op.get("source", "")
        dest = op.get("dest", "")

        if op_type == "delete":
            # Mark source as deleted
            if os.path.isdir(source) if source else False:
                # Mark all files under this dir as deleted
                for f in all_files:
                    if f.path.startswith(source + "/"):
                        deleted_paths.add(f.path)
            else:
                deleted_paths.add(source)
        elif op_type in ("copy", "move"):
            copied_paths.add(dest)
            if op_type == "move":
                deleted_paths.add(source)

    # Check which checksums would be lost
    checksums_lost = []
    warnings = []
    acknowledged = set(sess.warnings_acknowledged or [])

    for checksum, paths in checksum_paths.items():
        remaining = (paths - deleted_paths) | copied_paths
        # Check if any remaining path actually has this checksum
        has_remaining = False
        for p in paths:
            if p not in deleted_paths:
                has_remaining = True
                break
        if not has_remaining:
            checksums_lost.append(checksum)
            lost_files = [p for p in paths if p in deleted_paths]
            is_acknowledged = checksum in acknowledged
            warnings.append({
                "checksum": checksum,
                "files": lost_files,
                "acknowledged": is_acknowledged,
            })

    total_ops = len(ops)
    total_bytes = sum(
        f.size for f in all_files
        if f.path in deleted_paths or f.path in copied_paths
    )

    preview = {
        "operations_count": total_ops,
        "operations": ops,
        "checksums_total": len(checksum_paths),
        "checksums_preserved": len(checksum_paths) - len(checksums_lost),
        "checksums_lost": len(checksums_lost),
        "warnings": warnings,
        "all_acknowledged": all(w["acknowledged"] for w in warnings) if warnings else True,
        "bytes_affected": total_bytes,
        "ready_to_commit": len(checksums_lost) == 0 or all(w["acknowledged"] for w in warnings),
    }

    sess.status = "previewing"
    sess.preview_result = preview
    return preview


def _execute_operations_sync(ops: list[dict]) -> tuple[int, int, list[str]]:
    """Execute file operations synchronously. Returns (files_affected, bytes_affected, errors)."""
    files_affected = 0
    bytes_affected = 0
    errors = []

    # Execute copies first, then deletes (never delete before copy)
    copy_ops = [op for op in ops if op.get("type") in ("copy", "move")]
    delete_ops = [op for op in ops if op.get("type") == "delete"]

    for op in copy_ops:
        source = op.get("source", "")
        dest = op.get("dest", "")
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.isdir(source):
                shutil.copytree(source, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(source, dest)
                bytes_affected += os.path.getsize(dest)
            files_affected += 1

            if op.get("type") == "move" and os.path.exists(source):
                if os.path.isdir(source):
                    shutil.rmtree(source)
                else:
                    os.remove(source)
        except Exception as e:
            errors.append(f"Failed to {op['type']} {source}: {e}")

    for op in delete_ops:
        source = op.get("source", "")
        try:
            if os.path.isdir(source):
                for root, dirs, files in os.walk(source):
                    for f in files:
                        fp = os.path.join(root, f)
                        bytes_affected += os.path.getsize(fp)
                        files_affected += 1
                shutil.rmtree(source)
            elif os.path.exists(source):
                bytes_affected += os.path.getsize(source)
                os.remove(source)
                files_affected += 1
        except Exception as e:
            errors.append(f"Failed to delete {source}: {e}")

    return files_affected, bytes_affected, errors


async def commit_session(
    db: AsyncSession,
    session_id: int,
) -> AssimilateSession:
    """Execute all staged operations. Copies run before deletes."""
    sess = await get_session(db, session_id)
    if not sess:
        raise ValueError(f"Session {session_id} not found")
    if sess.status not in ("working", "previewing"):
        raise ValueError(f"Cannot commit session in '{sess.status}' state")

    # Run preview to verify
    preview = await preview_commit(db, session_id)
    if not preview["ready_to_commit"]:
        raise ValueError(
            f"Cannot commit: {preview['checksums_lost']} checksums would be lost. "
            "Acknowledge warnings first."
        )

    sess.status = "committing"
    await db.commit()

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        files_affected, bytes_affected, errors = await loop.run_in_executor(
            None,
            _execute_operations_sync,
            sess.staged_operations or [],
        )

        sess.files_affected = files_affected
        sess.bytes_affected = bytes_affected
        sess.committed_at = datetime.now(timezone.utc)

        if errors:
            sess.status = "committed"
            sess.error_message = "\n".join(errors)
        else:
            sess.status = "committed"
            sess.error_message = None

        return sess

    except Exception as e:
        sess.status = "failed"
        sess.error_message = str(e)
        return sess
