import logging
import os
import shutil
import subprocess
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.action import Action
from app.tasks.worker import huey

logger = logging.getLogger(__name__)


def _get_sync_session() -> Session:
    settings = get_settings()
    sync_url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
    engine = create_engine(sync_url, connect_args={"check_same_thread": False})
    return Session(engine)


@huey.task()
def execute_action_task(action_id: int):
    """Execute a confirmed consolidation action."""
    session = _get_sync_session()
    try:
        action = session.get(Action, action_id)
        if not action:
            logger.error("Action %d not found", action_id)
            return

        if action.status != "confirmed":
            logger.warning(
                "Action %d has status '%s', expected 'confirmed'",
                action_id, action.status,
            )
            return

        settings = get_settings()
        source = os.path.realpath(action.source_path)
        dest = os.path.realpath(action.dest_path) if action.dest_path else None

        if not source.startswith(settings.DATA_DIR):
            action.status = "failed"
            action.error_message = "Source path is outside DATA_DIR"
            session.commit()
            return

        action.status = "executing"
        session.commit()

        try:
            if action.action_type == "merge":
                if not dest:
                    raise ValueError("Destination required for merge")
                source_trailing = source.rstrip("/") + "/"
                result = subprocess.run(
                    ["rsync", "-avc", "--remove-source-files", source_trailing, dest],
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"rsync failed: {result.stderr}")
                # Try to remove empty source dirs after rsync
                subprocess.run(
                    ["find", source, "-type", "d", "-empty", "-delete"],
                    capture_output=True,
                    timeout=60,
                )

            elif action.action_type == "delete":
                if os.path.isdir(source):
                    shutil.rmtree(source)
                elif os.path.isfile(source):
                    os.remove(source)
                else:
                    raise FileNotFoundError(f"Source not found: {source}")

            elif action.action_type == "hardlink":
                if not dest:
                    raise ValueError("Destination required for hardlink")
                source_trailing = source.rstrip("/") + "/"
                result = subprocess.run(
                    ["rsync", "-avc", "--link-dest", source_trailing, source_trailing, dest],
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"rsync failed: {result.stderr}")

            elif action.action_type == "symlink":
                if not dest:
                    raise ValueError("Destination required for symlink")
                if os.path.exists(dest):
                    if os.path.isdir(dest):
                        shutil.rmtree(dest)
                    else:
                        os.remove(dest)
                os.symlink(source, dest)

            elif action.action_type == "move":
                if not dest:
                    raise ValueError("Destination required for move")
                shutil.move(source, dest)

            elif action.action_type in ("skip", "bookmark"):
                pass

            else:
                raise ValueError(f"Unknown action type: {action.action_type}")

            action.status = "completed"
            action.executed_at = datetime.now(timezone.utc)
            logger.info("Action %d completed successfully", action_id)

        except Exception as e:
            action.status = "failed"
            action.error_message = str(e)
            logger.error("Action %d failed: %s", action_id, e)

        session.commit()

    except Exception as e:
        logger.exception("Unexpected error executing action %d: %s", action_id, e)
    finally:
        session.close()
