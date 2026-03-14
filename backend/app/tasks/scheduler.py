"""
Automatic scan scheduler — runs as a standalone process managed by supervisord.

Polls the saved_scans table for scheduled scans that are due, creates
a new Scan run, and enqueues it via Huey. Also updates saved scan stats
when runs complete.
"""
import logging
import signal
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.saved_scan import SavedScan
from app.models.scan import Scan

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(levelname)s: %(message)s",
)

POLL_INTERVAL_SECONDS = 60
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


def _compute_next_run(saved: SavedScan) -> datetime | None:
    if not saved.schedule_enabled or not saved.schedule_interval:
        return None
    base = saved.last_run_at or datetime.now(timezone.utc)
    hour = saved.schedule_hour or 3
    val = saved.schedule_interval_value or 1

    if saved.schedule_interval == "hourly":
        nxt = base + timedelta(hours=val)
    elif saved.schedule_interval == "daily":
        nxt = base + timedelta(days=val)
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    elif saved.schedule_interval == "weekly":
        nxt = base + timedelta(weeks=val)
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    elif saved.schedule_interval == "monthly":
        nxt = base + timedelta(days=30 * val)
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    else:
        return None
    return nxt


def _is_due(saved: SavedScan, now: datetime) -> bool:
    if not saved.schedule_enabled:
        return False
    if saved.next_run_at and now >= saved.next_run_at:
        return True
    if not saved.last_run_at and saved.schedule_enabled:
        return True  # never run, schedule enabled — run now
    return False


def _update_completed_stats(session: Session):
    """Update saved_scan stats from recently completed runs."""
    # Find saved scans whose last_scan_id points to a completed scan
    # but whose cached stats are stale
    saved_scans = session.execute(
        select(SavedScan).where(SavedScan.last_scan_id.is_not(None))
    ).scalars().all()

    for saved in saved_scans:
        scan = session.get(Scan, saved.last_scan_id)
        if not scan or scan.status != "completed":
            continue
        # Update cached stats if they differ
        if (saved.last_total_files != scan.total_files
                or saved.last_duplicates_found != scan.duplicates_found
                or saved.last_space_recoverable != scan.space_recoverable):
            saved.last_total_files = scan.total_files
            saved.last_duplicates_found = scan.duplicates_found
            saved.last_space_recoverable = scan.space_recoverable
            session.commit()


def run_scheduler():
    """Main scheduler loop."""
    logger.info("Collective scheduler starting")

    while _running:
        try:
            session = _get_session()
            now = datetime.now(timezone.utc)

            # Check for due saved scans
            due_scans = session.execute(
                select(SavedScan).where(SavedScan.schedule_enabled == True)  # noqa: E712
            ).scalars().all()

            for saved in due_scans:
                if not _is_due(saved, now):
                    continue

                # Check no scan is currently running (one at a time for HDD perf)
                running = session.execute(
                    select(Scan).where(
                        Scan.status.in_(["running", "parsing", "analyzing", "pending"])
                    )
                ).scalars().first()

                if running:
                    logger.info(
                        "Skipping scheduled '%s' — scan %d is still %s",
                        saved.name, running.id, running.status
                    )
                    continue

                # Create a new scan run
                logger.info("Triggering scheduled scan: %s (saved_scan %d)", saved.name, saved.id)
                scan = Scan(
                    saved_scan_id=saved.id,
                    name=saved.name,
                    scanner=saved.scanner,
                    target_paths=saved.target_paths,
                    tagged_paths=saved.tagged_paths,
                    scanner_flags=saved.scanner_flags,
                    scan_depth=saved.scan_depth,
                    similarity_threshold=saved.similarity_threshold,
                    status="pending",
                )
                session.add(scan)
                session.commit()

                saved.last_run_at = now
                saved.last_scan_id = scan.id
                saved.total_runs += 1
                saved.next_run_at = _compute_next_run(saved)
                session.commit()

                # Enqueue
                try:
                    from app.tasks.scan_tasks import run_scan_task
                    run_scan_task(scan.id)
                    logger.info("Enqueued scan %d for saved_scan %d", scan.id, saved.id)
                except Exception as e:
                    logger.error("Failed to enqueue: %s", e)
                    scan.status = "failed"
                    scan.error_message = str(e)
                    session.commit()

            # Update stats for completed runs
            _update_completed_stats(session)

            session.close()

        except Exception:
            logger.exception("Scheduler error")

        # Sleep in small increments for clean shutdown
        for _ in range(POLL_INTERVAL_SECONDS):
            if not _running:
                break
            time.sleep(1)

    logger.info("Scheduler stopped")


if __name__ == "__main__":
    run_scheduler()
