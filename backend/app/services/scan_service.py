import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.action import Action, Bookmark
from app.models.duplicate import DuplicateDirectory, DuplicateFile
from app.models.scan import Scan
from app.models.similarity import DirectorySimilarity
from app.schemas.scan import ScanCreate

logger = logging.getLogger(__name__)


class ScanService:
    @staticmethod
    async def create_scan(db: AsyncSession, scan_create: ScanCreate) -> Scan:
        scan = Scan(
            name=scan_create.name,
            scanner=scan_create.scanner,
            target_paths=scan_create.target_paths,
            tagged_paths=scan_create.tagged_paths,
            scanner_flags=scan_create.scanner_flags,
            scan_depth=scan_create.scan_depth,
            similarity_threshold=scan_create.similarity_threshold or 50.0,
            status="pending",
        )
        db.add(scan)
        await db.flush()
        await db.refresh(scan)
        return scan

    @staticmethod
    async def get_scan(db: AsyncSession, scan_id: int) -> Optional[Scan]:
        result = await db.execute(select(Scan).where(Scan.id == scan_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def list_scans(
        db: AsyncSession, page: int = 1, per_page: int = 50
    ) -> tuple[list[Scan], int]:
        count_q = select(func.count()).select_from(Scan)
        total = (await db.execute(count_q)).scalar()

        q = (
            select(Scan)
            .order_by(desc(Scan.created_at))
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        result = await db.execute(q)
        scans = list(result.scalars().all())
        return scans, total

    @staticmethod
    async def update_scan_status(
        db: AsyncSession, scan_id: int, status: str, **kwargs: Any
    ) -> None:
        result = await db.execute(select(Scan).where(Scan.id == scan_id))
        scan = result.scalar_one_or_none()
        if not scan:
            raise ValueError(f"Scan {scan_id} not found")

        scan.status = status

        if status == "running" and scan.started_at is None:
            scan.started_at = datetime.now(timezone.utc)
        elif status in ("completed", "failed", "cancelled"):
            scan.completed_at = datetime.now(timezone.utc)

        for key, value in kwargs.items():
            if hasattr(scan, key):
                setattr(scan, key, value)

        await db.flush()

    @staticmethod
    async def delete_scan(db: AsyncSession, scan_id: int) -> None:
        await db.execute(delete(Bookmark).where(Bookmark.scan_id == scan_id))
        await db.execute(delete(Action).where(Action.scan_id == scan_id))
        await db.execute(delete(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan_id))
        await db.execute(delete(DuplicateDirectory).where(DuplicateDirectory.scan_id == scan_id))
        await db.execute(delete(DuplicateFile).where(DuplicateFile.scan_id == scan_id))
        await db.execute(delete(Scan).where(Scan.id == scan_id))
        await db.flush()
