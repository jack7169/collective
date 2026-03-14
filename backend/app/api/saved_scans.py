"""API for saved scan configurations with scheduling."""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.saved_scan import SavedScan
from app.models.scan import Scan
from app.schemas.common import PaginatedResponse
from app.schemas.scan import ScanResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/saved-scans", tags=["saved-scans"])


# --- Schemas ---

class SavedScanCreate(BaseModel):
    name: str
    description: Optional[str] = None
    scanner: str = "rmlint"
    target_paths: list[str]
    scanner_flags: Optional[dict] = None
    scan_depth: int = 5
    similarity_threshold: float = 10.0
    schedule_enabled: bool = False
    schedule_interval: Optional[str] = None  # hourly|daily|weekly|monthly
    schedule_interval_value: int = 1
    schedule_day_of_week: Optional[int] = None
    schedule_hour: int = 3


class SavedScanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    target_paths: Optional[list[str]] = None
    tagged_paths: Optional[list[str]] = None
    scan_depth: Optional[int] = None
    similarity_threshold: Optional[float] = None
    schedule_enabled: Optional[bool] = None
    schedule_interval: Optional[str] = None
    schedule_interval_value: Optional[int] = None
    schedule_day_of_week: Optional[int] = None
    schedule_hour: Optional[int] = None


class SavedScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    scanner: str
    target_paths: list[str]
    tagged_paths: Optional[list[str]]
    scanner_flags: Optional[dict]
    scan_depth: Optional[int]
    similarity_threshold: float
    schedule_enabled: bool
    schedule_interval: Optional[str]
    schedule_interval_value: int
    schedule_day_of_week: Optional[int]
    schedule_hour: int
    last_run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    last_scan_id: Optional[int]
    total_runs: int
    last_total_files: Optional[int]
    last_duplicates_found: Optional[int]
    last_space_recoverable: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


# --- Helpers ---

def compute_next_run(saved: SavedScan) -> datetime | None:
    """Compute next scheduled run time based on interval."""
    if not saved.schedule_enabled or not saved.schedule_interval:
        return None

    base = saved.last_run_at or datetime.now(timezone.utc)
    hour = saved.schedule_hour or 3

    if saved.schedule_interval == "hourly":
        nxt = base + timedelta(hours=saved.schedule_interval_value or 1)
    elif saved.schedule_interval == "daily":
        nxt = base + timedelta(days=saved.schedule_interval_value or 1)
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    elif saved.schedule_interval == "weekly":
        nxt = base + timedelta(weeks=saved.schedule_interval_value or 1)
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    elif saved.schedule_interval == "monthly":
        nxt = base + timedelta(days=30 * (saved.schedule_interval_value or 1))
        nxt = nxt.replace(hour=hour, minute=0, second=0, microsecond=0)
    else:
        return None

    return nxt


# --- Endpoints ---

@router.get("", response_model=list[SavedScanResponse])
async def list_saved_scans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SavedScan).order_by(desc(SavedScan.updated_at))
    )
    return [SavedScanResponse.model_validate(s) for s in result.scalars().all()]


@router.post("", response_model=SavedScanResponse, status_code=201)
async def create_saved_scan(body: SavedScanCreate, db: AsyncSession = Depends(get_db)):
    saved = SavedScan(**body.model_dump())
    saved.next_run_at = compute_next_run(saved)
    db.add(saved)
    await db.commit()
    await db.refresh(saved)
    return SavedScanResponse.model_validate(saved)


@router.get("/{saved_id}", response_model=SavedScanResponse)
async def get_saved_scan(saved_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SavedScan).where(SavedScan.id == saved_id))
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved scan not found")
    return SavedScanResponse.model_validate(saved)


@router.put("/{saved_id}", response_model=SavedScanResponse)
async def update_saved_scan(
    saved_id: int, body: SavedScanUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(SavedScan).where(SavedScan.id == saved_id))
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved scan not found")

    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(saved, key, value)

    saved.next_run_at = compute_next_run(saved)
    await db.commit()
    await db.refresh(saved)
    return SavedScanResponse.model_validate(saved)


@router.delete("/{saved_id}", status_code=204)
async def delete_saved_scan(saved_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SavedScan).where(SavedScan.id == saved_id))
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved scan not found")
    await db.delete(saved)
    await db.commit()


@router.post("/{saved_id}/run", response_model=ScanResponse)
async def run_saved_scan(saved_id: int, db: AsyncSession = Depends(get_db)):
    """Manually trigger a run of a saved scan."""
    result = await db.execute(select(SavedScan).where(SavedScan.id == saved_id))
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved scan not found")

    # Check no scan is currently running
    running_q = select(func.count()).select_from(Scan).where(
        Scan.status.in_(["running", "parsing", "analyzing", "pending"])
    )
    running_count = (await db.execute(running_q)).scalar()
    if running_count > 0:
        raise HTTPException(status_code=409, detail="A scan is already running. Wait for it to complete.")

    # Create a new scan run
    scan = Scan(
        saved_scan_id=saved.id,
        name=f"{saved.name}",
        scanner=saved.scanner,
        target_paths=saved.target_paths,
        tagged_paths=saved.tagged_paths,
        scanner_flags=saved.scanner_flags,
        scan_depth=saved.scan_depth,
        similarity_threshold=saved.similarity_threshold,
        status="pending",
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    # Update saved scan state
    saved.last_run_at = datetime.now(timezone.utc)
    saved.last_scan_id = scan.id
    saved.total_runs += 1
    saved.next_run_at = compute_next_run(saved)
    await db.commit()

    # Enqueue task
    try:
        from app.tasks.scan_tasks import run_scan_task
        run_scan_task(scan.id)
    except Exception as e:
        logger.error("Failed to enqueue scan: %s", e)
        scan.status = "failed"
        scan.error_message = str(e)
        await db.commit()

    return ScanResponse.model_validate(scan)


@router.get("/{saved_id}/runs")
async def list_saved_scan_runs(
    saved_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get run history for a saved scan, ordered newest first."""
    result = await db.execute(select(SavedScan).where(SavedScan.id == saved_id))
    saved = result.scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved scan not found")

    count_q = select(func.count()).select_from(Scan).where(Scan.saved_scan_id == saved_id)
    total = (await db.execute(count_q)).scalar()

    q = (
        select(Scan)
        .where(Scan.saved_scan_id == saved_id)
        .order_by(desc(Scan.created_at))
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    runs = (await db.execute(q)).scalars().all()

    return PaginatedResponse.create(
        items=[ScanResponse.model_validate(r) for r in runs],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("/from-scan/{scan_id}", response_model=SavedScanResponse)
async def create_saved_from_existing(scan_id: int, db: AsyncSession = Depends(get_db)):
    """Create a saved scan from an existing completed scan's configuration."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    saved = SavedScan(
        name=scan.name,
        scanner=scan.scanner,
        target_paths=scan.target_paths,
        tagged_paths=scan.tagged_paths,
        scanner_flags=scan.scanner_flags,
        scan_depth=scan.scan_depth,
        similarity_threshold=scan.similarity_threshold,
        last_scan_id=scan.id,
        last_run_at=scan.completed_at or scan.started_at,
        total_runs=1,
        last_total_files=scan.total_files,
        last_duplicates_found=scan.duplicates_found,
        last_space_recoverable=scan.space_recoverable,
    )
    db.add(saved)
    await db.commit()
    await db.refresh(saved)

    # Link the scan back
    scan.saved_scan_id = saved.id
    await db.commit()

    return SavedScanResponse.model_validate(saved)
