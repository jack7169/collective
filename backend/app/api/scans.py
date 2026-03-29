import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import PaginatedResponse
from app.schemas.scan import ReanalyzeRequest, ScanCreate, ScanProgress, ScanResponse
from app.services.scan_service import ScanService
from app.api.websocket import manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scans", tags=["scans"])


@router.get("", response_model=PaginatedResponse[ScanResponse])
async def list_scans(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    scans, total = await ScanService.list_scans(db, page, per_page)
    return PaginatedResponse.create(
        items=[ScanResponse.model_validate(s) for s in scans],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("", response_model=ScanResponse, status_code=201)
async def create_scan(
    scan_create: ScanCreate,
    db: AsyncSession = Depends(get_db),
):
    scan = await ScanService.create_scan(db, scan_create)
    try:
        from app.tasks.scan_tasks import run_scan_task
        run_scan_task(scan.id)
        logger.info("Enqueued scan task for scan %d", scan.id)
    except Exception as e:
        logger.error("Failed to enqueue scan task: %s", e)
        await ScanService.update_scan_status(
            db, scan.id, "failed", error_message=f"Failed to enqueue task: {e}"
        )
        await db.commit()
    return ScanResponse.model_validate(scan)


@router.get("/{scan_id}", response_model=ScanResponse)
async def get_scan(scan_id: int, db: AsyncSession = Depends(get_db)):
    scan = await ScanService.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return ScanResponse.model_validate(scan)


@router.delete("/{scan_id}", status_code=204)
async def delete_scan(scan_id: int, db: AsyncSession = Depends(get_db)):
    scan = await ScanService.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    await ScanService.delete_scan(db, scan_id)
    await db.commit()


@router.post("/{scan_id}/cancel", response_model=ScanResponse)
async def cancel_scan(scan_id: int, db: AsyncSession = Depends(get_db)):
    scan = await ScanService.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel scan with status '{scan.status}'")
    await ScanService.update_scan_status(db, scan_id, "cancelled")
    await db.commit()
    scan = await ScanService.get_scan(db, scan_id)
    return ScanResponse.model_validate(scan)


@router.post("/{scan_id}/resume", response_model=ScanResponse)
async def resume_scan(scan_id: int, db: AsyncSession = Depends(get_db)):
    """Resume an interrupted scan from where it left off.

    Phase-aware resume:
    - Interrupted during 'running' → re-runs scanner (fclones cache speeds this up)
    - Interrupted during 'parsing' → skips scanner, re-parses output file
    - Interrupted during 'analyzing' → skips scanner+parsing, re-runs analysis

    Progress, name, and config are preserved from the original scan.
    """
    scan = await ScanService.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status not in ("interrupted", "failed", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Can only resume interrupted, failed, or cancelled scans (current: '{scan.status}')"
        )

    # For failed/cancelled scans that don't have an interrupted_phase, treat as full re-run
    if not scan.interrupted_phase and scan.status in ("failed", "cancelled"):
        scan.interrupted_phase = "running"

    # Set status to interrupted so the task picks it up (task exits early on "cancelled")
    scan.status = "interrupted"
    scan.error_message = None
    scan.completed_at = None
    await db.commit()

    try:
        from app.tasks.scan_tasks import run_scan_task
        run_scan_task(scan.id)
        logger.info("Enqueued resume for scan %d (phase: %s)", scan_id, scan.interrupted_phase)
    except Exception as e:
        logger.error("Failed to enqueue resume: %s", e)
        scan = await ScanService.get_scan(db, scan_id)
        if scan:
            scan.status = "failed"
            scan.error_message = f"Failed to enqueue resume: {e}"
            await db.commit()
        raise HTTPException(status_code=500, detail=str(e))

    # Re-fetch to get latest state (task may have already started)
    await db.refresh(scan)
    return ScanResponse.model_validate(scan)


@router.post("/{scan_id}/reanalyze", response_model=ScanResponse)
async def reanalyze_scan(
    scan_id: int,
    body: ReanalyzeRequest,
    db: AsyncSession = Depends(get_db),
):
    scan = await ScanService.get_scan(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status not in ("completed", "failed"):
        raise HTTPException(status_code=400, detail="Scan must be completed or failed to reanalyze")

    kwargs = {}
    if body.similarity_threshold is not None:
        kwargs["similarity_threshold"] = body.similarity_threshold
    if body.scan_depth is not None:
        kwargs["scan_depth"] = body.scan_depth
    await ScanService.update_scan_status(db, scan_id, "analyzing", **kwargs)
    await db.commit()

    try:
        from app.tasks.scan_tasks import run_reanalysis_task
        run_reanalysis_task(scan_id)
    except Exception as e:
        logger.error("Failed to enqueue reanalysis task: %s", e)
        await ScanService.update_scan_status(
            db, scan_id, "failed", error_message=f"Failed to enqueue reanalysis: {e}"
        )
        await db.commit()

    scan = await ScanService.get_scan(db, scan_id)
    return ScanResponse.model_validate(scan)


@router.websocket("/{scan_id}/ws")
async def scan_progress_ws(scan_id: int, websocket: WebSocket):
    await manager.connect(scan_id, websocket)
    try:
        while True:
            from app.database import async_session
            async with async_session() as db:
                scan = await ScanService.get_scan(db, scan_id)
                if not scan:
                    await websocket.send_json({"error": "Scan not found"})
                    break

                from datetime import datetime, timezone
                elapsed = None
                if scan.started_at:
                    now = datetime.now(timezone.utc)
                    started = scan.started_at if scan.started_at.tzinfo else scan.started_at.replace(tzinfo=timezone.utc)
                    elapsed = int((now - started).total_seconds())

                progress = ScanProgress(
                    scan_id=scan.id,
                    status=scan.status,
                    progress_percent=scan.progress_percent,
                    progress_message=scan.progress_message,
                    total_files=scan.total_files,
                    total_dirs=scan.total_dirs,
                    total_size=scan.total_size,
                    duplicates_found=scan.duplicates_found,
                    elapsed_seconds=elapsed,
                    started_at=scan.started_at,
                )
                await websocket.send_json(progress.model_dump(mode="json"))

                if scan.status in ("completed", "failed"):
                    break

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket error for scan %d: %s", scan_id, e)
    finally:
        await manager.disconnect(scan_id, websocket)
