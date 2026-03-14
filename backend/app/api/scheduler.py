"""API endpoints for scan scheduling and cache management."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.settings import Setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scheduler", tags=["scheduler"])

SCHEDULE_SETTINGS_KEY = "scan_schedules"
CACHE_METADATA_KEY = "scan_cache_metadata"


class ScheduleCreate(BaseModel):
    name: str
    scanner: str = "rmlint"
    target_paths: list[str]
    tagged_paths: Optional[list[str]] = None
    scanner_flags: Optional[dict] = None
    scan_depth: Optional[int] = None
    similarity_threshold: float = 50.0
    interval: str = "daily"  # hourly, daily, weekly, monthly, once
    interval_value: int = 1
    scheduled_at: Optional[str] = None  # ISO format, for "once" type
    enabled: bool = True


class ScheduleResponse(ScheduleCreate):
    id: int
    last_run: Optional[str] = None


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    interval: Optional[str] = None
    interval_value: Optional[int] = None
    similarity_threshold: Optional[float] = None
    scan_depth: Optional[int] = None


async def _get_schedules(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Setting).where(Setting.key == SCHEDULE_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return []
    try:
        return json.loads(setting.value)
    except (json.JSONDecodeError, TypeError):
        return []


async def _save_schedules(db: AsyncSession, schedules: list[dict]):
    result = await db.execute(
        select(Setting).where(Setting.key == SCHEDULE_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    value = json.dumps(schedules)
    if setting:
        setting.value = value
    else:
        db.add(Setting(key=SCHEDULE_SETTINGS_KEY, value=value))
    await db.commit()


@router.get("/schedules")
async def list_schedules(db: AsyncSession = Depends(get_db)):
    schedules = await _get_schedules(db)
    return [
        {**s, "id": i}
        for i, s in enumerate(schedules)
    ]


@router.post("/schedules")
async def create_schedule(body: ScheduleCreate, db: AsyncSession = Depends(get_db)):
    schedules = await _get_schedules(db)
    new_schedule = body.model_dump()
    new_schedule["last_run"] = None
    schedules.append(new_schedule)
    await _save_schedules(db, schedules)
    return {**new_schedule, "id": len(schedules) - 1}


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    body: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
):
    schedules = await _get_schedules(db)
    if schedule_id < 0 or schedule_id >= len(schedules):
        raise HTTPException(status_code=404, detail="Schedule not found")

    updates = body.model_dump(exclude_unset=True)
    schedules[schedule_id].update(updates)
    await _save_schedules(db, schedules)
    return {**schedules[schedule_id], "id": schedule_id}


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: int, db: AsyncSession = Depends(get_db)):
    schedules = await _get_schedules(db)
    if schedule_id < 0 or schedule_id >= len(schedules):
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedules.pop(schedule_id)
    await _save_schedules(db, schedules)
    return {"status": "deleted"}


@router.get("/cache")
async def get_cache_status(db: AsyncSession = Depends(get_db)):
    """Get cache metadata showing which scan data is persisted."""
    result = await db.execute(
        select(Setting).where(Setting.key == CACHE_METADATA_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {"scans": [], "total_cached": 0}
    try:
        scans = json.loads(setting.value)
        return {"scans": scans, "total_cached": len(scans)}
    except (json.JSONDecodeError, TypeError):
        return {"scans": [], "total_cached": 0}
