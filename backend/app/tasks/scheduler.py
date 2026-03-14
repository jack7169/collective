"""
Automatic scan scheduler — runs as a standalone process managed by supervisord.

Checks for scheduled scans and enqueues them when due. Supports:
- Cron-style recurring schedules (daily, weekly, monthly, custom interval)
- One-shot scheduled scans (run once at a specific time)
- Scan data cache persistence between container restarts
"""
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.scan import Scan
from app.models.settings import Setting

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(levelname)s: %(message)s",
)

POLL_INTERVAL_SECONDS = 60
SCHEDULE_SETTINGS_KEY = "scan_schedules"
CACHE_METADATA_KEY = "scan_cache_metadata"

_running = True


def _signal_handler(signum, frame):
    global _running
    logger.info("Received signal %d, shutting down scheduler", signum)
    _running = False


signal.signal(signal.SIGTERM, _signal_handler)
signal.signal(signal.SIGINT, _signal_handler)


def _get_session() -> Session:
    settings = get_settings()
    sync_url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
    engine = create_engine(sync_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return Session(engine)


def _get_schedules(session: Session) -> list[dict]:
    """Load scan schedules from settings table."""
    result = session.execute(
        select(Setting).where(Setting.key == SCHEDULE_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return []
    try:
        return json.loads(setting.value)
    except (json.JSONDecodeError, TypeError):
        return []


def _save_schedules(session: Session, schedules: list[dict]):
    """Save scan schedules to settings table."""
    result = session.execute(
        select(Setting).where(Setting.key == SCHEDULE_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    value = json.dumps(schedules)
    if setting:
        setting.value = value
        setting.updated_at = datetime.now(timezone.utc)
    else:
        session.add(Setting(key=SCHEDULE_SETTINGS_KEY, value=value))
    session.commit()


def _is_scan_due(schedule: dict, now: datetime) -> bool:
    """Check if a schedule is due to run."""
    if not schedule.get("enabled", True):
        return False

    last_run_str = schedule.get("last_run")
    interval_type = schedule.get("interval", "daily")
    interval_value = schedule.get("interval_value", 1)

    if last_run_str:
        last_run = datetime.fromisoformat(last_run_str)
    else:
        # Never run before — run now
        return True

    if interval_type == "hourly":
        next_run = last_run + timedelta(hours=interval_value)
    elif interval_type == "daily":
        next_run = last_run + timedelta(days=interval_value)
    elif interval_type == "weekly":
        next_run = last_run + timedelta(weeks=interval_value)
    elif interval_type == "monthly":
        next_run = last_run + timedelta(days=30 * interval_value)
    elif interval_type == "once":
        scheduled_at_str = schedule.get("scheduled_at")
        if not scheduled_at_str:
            return False
        scheduled_at = datetime.fromisoformat(scheduled_at_str)
        return now >= scheduled_at and not last_run_str
    else:
        return False

    return now >= next_run


def _enqueue_scheduled_scan(session: Session, schedule: dict):
    """Create a new scan from a schedule definition and enqueue it."""
    from app.tasks.scan_tasks import run_scan_task

    scan = Scan(
        name=schedule.get("name", f"Scheduled scan - {datetime.now(timezone.utc).isoformat()}"),
        scanner=schedule.get("scanner", "rmlint"),
        target_paths=schedule.get("target_paths", []),
        tagged_paths=schedule.get("tagged_paths"),
        scanner_flags=schedule.get("scanner_flags"),
        scan_depth=schedule.get("scan_depth"),
        similarity_threshold=schedule.get("similarity_threshold", 50.0),
        status="pending",
    )
    session.add(scan)
    session.commit()

    logger.info("Created scheduled scan %d: %s", scan.id, scan.name)
    run_scan_task(scan.id)


def _update_scan_cache_metadata(session: Session):
    """
    Update cache metadata to track scan data persistence.
    Records which scans have cached data available for quick re-analysis
    without re-scanning disk.
    """
    settings = get_settings()
    cache_dir = os.path.join(settings.CONFIG_DIR, "cache")
    os.makedirs(cache_dir, exist_ok=True)

    # Find completed scans
    result = session.execute(
        select(Scan).where(Scan.status == "completed")
    )
    completed_scans = result.scalars().all()

    cache_meta = []
    for scan in completed_scans:
        cache_meta.append({
            "scan_id": scan.id,
            "name": scan.name,
            "scanner": scan.scanner,
            "target_paths": scan.target_paths,
            "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
            "total_files": scan.total_files,
            "duplicates_found": scan.duplicates_found,
            "space_recoverable": scan.space_recoverable,
            "has_file_data": True,
            "has_similarity_data": True,
        })

    result = session.execute(
        select(Setting).where(Setting.key == CACHE_METADATA_KEY)
    )
    setting = result.scalar_one_or_none()
    value = json.dumps(cache_meta)
    if setting:
        setting.value = value
        setting.updated_at = datetime.now(timezone.utc)
    else:
        session.add(Setting(key=CACHE_METADATA_KEY, value=value))
    session.commit()


def run_scheduler():
    """Main scheduler loop."""
    logger.info("Collective scheduler starting")
    settings = get_settings()

    while _running:
        try:
            session = _get_session()

            # Check for due schedules
            schedules = _get_schedules(session)
            now = datetime.now(timezone.utc)
            modified = False

            for schedule in schedules:
                if _is_scan_due(schedule, now):
                    # Check no scan is currently running
                    running = session.execute(
                        select(Scan).where(Scan.status.in_(["running", "parsing", "analyzing"]))
                    ).scalar_one_or_none()

                    if running:
                        logger.info(
                            "Skipping scheduled scan '%s' — scan %d is still running",
                            schedule.get("name", "unnamed"),
                            running.id,
                        )
                        continue

                    logger.info("Triggering scheduled scan: %s", schedule.get("name"))
                    _enqueue_scheduled_scan(session, schedule)
                    schedule["last_run"] = now.isoformat()
                    modified = True

                    # Disable one-shot schedules after execution
                    if schedule.get("interval") == "once":
                        schedule["enabled"] = False

            if modified:
                _save_schedules(session, schedules)

            # Periodically update cache metadata
            _update_scan_cache_metadata(session)

            session.close()

        except Exception:
            logger.exception("Scheduler error")

        # Sleep in small increments to allow clean shutdown
        for _ in range(POLL_INTERVAL_SECONDS):
            if not _running:
                break
            time.sleep(1)

    logger.info("Scheduler stopped")


if __name__ == "__main__":
    run_scheduler()
