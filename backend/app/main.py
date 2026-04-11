import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _recover_orphaned_tasks():
    """Mark tasks that were interrupted by a restart."""
    from datetime import datetime, timezone
    from sqlalchemy import update
    from app.database import async_session
    from app.models.scan import Scan
    from app.models.action import Action

    async with async_session() as db:
        # Recover orphaned scans — preserve the phase they were in for resume
        from sqlalchemy import select as sa_select
        orphaned_q = sa_select(Scan).where(
            Scan.status.in_(["running", "parsing", "analyzing", "pending"])
        )
        orphaned_result = await db.execute(orphaned_q)
        orphaned_scans = orphaned_result.scalars().all()
        for scan in orphaned_scans:
            prev_phase = scan.status
            if prev_phase == "pending":
                # Pending scans that survived a restart were never picked up — re-enqueue them
                try:
                    from app.tasks.scan_tasks import run_scan_task
                    run_scan_task(scan.id)
                    logger.info("Re-enqueued pending scan %d", scan.id)
                except Exception as e:
                    scan.status = "failed"
                    scan.error_message = f"Failed to re-enqueue after restart: {e}"
                    scan.completed_at = datetime.now(timezone.utc)
                    logger.error("Failed to re-enqueue scan %d: %s", scan.id, e)
            else:
                # Accumulate elapsed time from this run before marking interrupted
                if scan.resumed_at:
                    run_elapsed = int((datetime.now(timezone.utc) - scan.resumed_at.replace(tzinfo=timezone.utc)).total_seconds())
                    scan.accumulated_seconds = (scan.accumulated_seconds or 0) + run_elapsed
                scan.interrupted_phase = prev_phase
                scan.status = "interrupted"
                scan.error_message = f"Interrupted during {prev_phase} by restart"
                scan.completed_at = datetime.now(timezone.utc)
                logger.warning("Recovered orphaned scan %d (was %s) → interrupted", scan.id, prev_phase)

        # Recover orphaned actions
        result = await db.execute(
            update(Action)
            .where(Action.status == "executing")
            .values(
                status="failed",
                error_message="Interrupted by restart",
            )
            .returning(Action.id)
        )
        orphaned_actions = result.all()
        for (action_id,) in orphaned_actions:
            logger.warning("Recovered orphaned action %d → failed", action_id)

        await db.commit()

    total = len(orphaned_scans) + len(orphaned_actions)
    if total:
        logger.info("Recovered %d orphaned tasks on startup", total)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Collective backend...")
    os.makedirs(settings.CONFIG_DIR, exist_ok=True)
    await init_db()
    logger.info("Database initialized")
    await _recover_orphaned_tasks()
    yield
    logger.info("Shutting down Collective backend...")


app = FastAPI(
    title="Collective",
    description="Duplicate directory detection and consolidation for Unraid",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.router import api_router
app.include_router(api_router)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(PermissionError)
async def permission_error_handler(request: Request, exc: PermissionError):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(FileNotFoundError)
async def not_found_error_handler(request: Request, exc: FileNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


# SPA frontend serving
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(static_dir):
    # Serve static assets (JS, CSS, etc.)
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    # Catch-all route for SPA: serve index.html for any non-API route
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If it's a real static file, serve it
        file_path = os.path.join(static_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html for SPA routing
        return FileResponse(os.path.join(static_dir, "index.html"))
