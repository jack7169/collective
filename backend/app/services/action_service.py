import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.action import Action
from app.schemas.action import ActionCreate

logger = logging.getLogger(__name__)


class ActionService:
    @staticmethod
    async def create_action(db: AsyncSession, action_create: ActionCreate) -> Action:
        action = Action(
            scan_id=action_create.scan_id,
            similarity_id=action_create.similarity_id,
            action_type=action_create.action_type,
            source_path=action_create.source_path,
            dest_path=action_create.dest_path,
            notes=action_create.notes,
            status="planned",
        )
        db.add(action)
        await db.flush()
        await db.refresh(action)
        return action

    @staticmethod
    async def list_actions(
        db: AsyncSession,
        scan_id: Optional[int] = None,
        status: Optional[str] = None,
        page: int = 1,
        per_page: int = 50,
    ) -> tuple[list[Action], int]:
        filters = []
        if scan_id is not None:
            filters.append(Action.scan_id == scan_id)
        if status is not None:
            filters.append(Action.status == status)

        count_q = select(func.count()).select_from(Action)
        if filters:
            count_q = count_q.where(*filters)
        total = (await db.execute(count_q)).scalar()

        q = select(Action).order_by(desc(Action.created_at))
        if filters:
            q = q.where(*filters)
        q = q.offset((page - 1) * per_page).limit(per_page)

        result = await db.execute(q)
        actions = list(result.scalars().all())
        return actions, total

    @staticmethod
    async def run_dry_run(db: AsyncSession, action_id: int) -> Action:
        result = await db.execute(select(Action).where(Action.id == action_id))
        action = result.scalar_one_or_none()
        if not action:
            raise ValueError(f"Action {action_id} not found")

        settings = get_settings()
        source = os.path.realpath(action.source_path)
        dest = os.path.realpath(action.dest_path) if action.dest_path else None

        if not source.startswith(settings.DATA_DIR):
            action.status = "failed"
            action.error_message = "Source path is outside DATA_DIR"
            await db.flush()
            return action

        if action.action_type in ("merge", "move", "hardlink", "symlink"):
            if not dest:
                action.status = "failed"
                action.error_message = "Destination path is required for this action type"
                await db.flush()
                return action

            source_trailing = source.rstrip("/") + "/"
            cmd = ["rsync", "-avcn", "--delete", source_trailing, dest]

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
                action.dry_run_output = stdout.decode("utf-8", errors="replace")
                if stderr:
                    action.dry_run_output += "\n--- stderr ---\n" + stderr.decode("utf-8", errors="replace")
                action.status = "dry_run"

                lines = stdout.decode("utf-8", errors="replace").strip().split("\n")
                file_lines = [l for l in lines if l and not l.startswith("sending") and not l.startswith("sent") and not l.startswith("total")]
                action.files_affected = len(file_lines)

            except asyncio.TimeoutError:
                action.status = "failed"
                action.error_message = "Dry-run timed out after 120 seconds"
            except FileNotFoundError:
                action.status = "failed"
                action.error_message = "rsync not found on system"

        elif action.action_type == "delete":
            total_size = 0
            file_count = 0
            try:
                for root, dirs, files in os.walk(source):
                    for f in files:
                        fp = os.path.join(root, f)
                        try:
                            total_size += os.path.getsize(fp)
                            file_count += 1
                        except OSError:
                            pass
                action.dry_run_output = f"Would delete {file_count} files ({total_size} bytes) from {source}"
                action.files_affected = file_count
                action.bytes_affected = total_size
                action.status = "dry_run"
            except OSError as e:
                action.status = "failed"
                action.error_message = str(e)

        else:
            action.dry_run_output = f"Dry-run not applicable for action type '{action.action_type}'"
            action.status = "dry_run"

        await db.flush()
        return action

    @staticmethod
    async def execute_action(db: AsyncSession, action_id: int) -> Action:
        result = await db.execute(select(Action).where(Action.id == action_id))
        action = result.scalar_one_or_none()
        if not action:
            raise ValueError(f"Action {action_id} not found")

        if action.status != "confirmed":
            raise ValueError(f"Action must be confirmed before execution, current status: {action.status}")

        settings = get_settings()
        source = os.path.realpath(action.source_path)
        dest = os.path.realpath(action.dest_path) if action.dest_path else None

        if not source.startswith(settings.DATA_DIR):
            action.status = "failed"
            action.error_message = "Source path is outside DATA_DIR"
            await db.flush()
            return action

        action.status = "executing"
        await db.flush()

        try:
            if action.action_type == "merge":
                source_trailing = source.rstrip("/") + "/"
                cmd = ["rsync", "-avc", "--remove-source-files", source_trailing, dest]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
                if proc.returncode != 0:
                    raise RuntimeError(stderr.decode("utf-8", errors="replace"))

            elif action.action_type == "delete":
                import shutil
                shutil.rmtree(source)

            elif action.action_type == "hardlink":
                source_trailing = source.rstrip("/") + "/"
                cmd = ["rsync", "-avc", "--link-dest", source_trailing, source_trailing, dest]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
                if proc.returncode != 0:
                    raise RuntimeError(stderr.decode("utf-8", errors="replace"))

            elif action.action_type == "symlink":
                if os.path.exists(dest):
                    import shutil
                    shutil.rmtree(dest)
                os.symlink(source, dest)

            elif action.action_type == "move":
                import shutil
                shutil.move(source, dest)

            elif action.action_type == "reflink":
                # BTRFS CoW dedup — share physical blocks without hardlink fragility
                from app.services.btrfs_service import dedupe_files_reflink, detect_btrfs
                btrfs_status = detect_btrfs(source)
                if not btrfs_status.is_btrfs:
                    raise RuntimeError("Reflink requires BTRFS filesystem")
                # Walk source dir, reflink each file with its counterpart in dest
                deduped = 0
                for root, dirs, files in os.walk(source):
                    for f in files:
                        src_file = os.path.join(root, f)
                        rel = os.path.relpath(src_file, source)
                        dst_file = os.path.join(dest, rel)
                        if os.path.isfile(dst_file):
                            if dedupe_files_reflink(src_file, dst_file):
                                deduped += 1
                action.files_affected = deduped

            elif action.action_type in ("skip", "bookmark"):
                pass

            action.status = "completed"
            action.executed_at = datetime.now(timezone.utc)

        except Exception as e:
            action.status = "failed"
            action.error_message = str(e)
            logger.error("Action %d failed: %s", action_id, e)

        await db.flush()
        return action
