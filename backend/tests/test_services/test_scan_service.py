import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scan import Scan
from app.schemas.scan import ScanCreate
from app.services.scan_service import ScanService


@pytest.mark.asyncio
async def test_create_scan(db_session: AsyncSession):
    scan_create = ScanCreate(
        name="Test",
        scanner="rmlint",
        target_paths=["/data/test"],
    )
    scan = await ScanService.create_scan(db_session, scan_create)
    assert scan.id is not None
    assert scan.name == "Test"
    assert scan.status == "pending"
    assert scan.scanner == "rmlint"


@pytest.mark.asyncio
async def test_get_scan(db_session: AsyncSession):
    scan_create = ScanCreate(
        name="Get Test",
        scanner="rmlint",
        target_paths=["/data/test"],
    )
    scan = await ScanService.create_scan(db_session, scan_create)
    await db_session.commit()

    fetched = await ScanService.get_scan(db_session, scan.id)
    assert fetched is not None
    assert fetched.name == "Get Test"


@pytest.mark.asyncio
async def test_get_scan_not_found(db_session: AsyncSession):
    fetched = await ScanService.get_scan(db_session, 9999)
    assert fetched is None


@pytest.mark.asyncio
async def test_list_scans(db_session: AsyncSession):
    for i in range(3):
        await ScanService.create_scan(
            db_session,
            ScanCreate(name=f"Scan {i}", scanner="rmlint", target_paths=["/data"]),
        )
    await db_session.commit()

    scans, total = await ScanService.list_scans(db_session, page=1, per_page=10)
    assert total == 3
    assert len(scans) == 3


@pytest.mark.asyncio
async def test_update_scan_status(db_session: AsyncSession):
    scan = await ScanService.create_scan(
        db_session,
        ScanCreate(name="Status Test", scanner="rmlint", target_paths=["/data"]),
    )
    await db_session.commit()

    await ScanService.update_scan_status(db_session, scan.id, "running")
    await db_session.commit()

    updated = await ScanService.get_scan(db_session, scan.id)
    assert updated.status == "running"
    assert updated.started_at is not None


@pytest.mark.asyncio
async def test_delete_scan(db_session: AsyncSession):
    scan = await ScanService.create_scan(
        db_session,
        ScanCreate(name="Delete Test", scanner="rmlint", target_paths=["/data"]),
    )
    await db_session.commit()

    await ScanService.delete_scan(db_session, scan.id)
    await db_session.commit()

    deleted = await ScanService.get_scan(db_session, scan.id)
    assert deleted is None
