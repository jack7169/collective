import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.duplicate import DuplicateFile
from app.models.scan import Scan
from app.models.similarity import DirectorySimilarity
from app.services.analysis_service import AnalysisService


@pytest.mark.asyncio
async def test_compute_similarities_empty(db_session: AsyncSession):
    scan = Scan(name="Empty", scanner="rmlint", target_paths=["/data"], status="analyzing")
    db_session.add(scan)
    await db_session.flush()

    count = await AnalysisService.compute_similarities(db_session, scan.id, threshold=50.0)
    assert count == 0


@pytest.mark.asyncio
async def test_compute_similarities_exact_match(db_session: AsyncSession):
    scan = Scan(name="Exact", scanner="rmlint", target_paths=["/data"], status="analyzing")
    db_session.add(scan)
    await db_session.flush()

    # Two directories with identical checksums
    files = [
        DuplicateFile(scan_id=scan.id, checksum="abc123", path="/data/dir_a/file1.txt", size=100, is_original=True, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="def456", path="/data/dir_a/file2.txt", size=200, is_original=True, group_id="g2"),
        DuplicateFile(scan_id=scan.id, checksum="abc123", path="/data/dir_b/file1.txt", size=100, is_original=False, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="def456", path="/data/dir_b/file2.txt", size=200, is_original=False, group_id="g2"),
    ]
    db_session.add_all(files)
    await db_session.flush()

    count = await AnalysisService.compute_similarities(db_session, scan.id, threshold=50.0)
    assert count == 1

    result = await db_session.execute(
        select(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan.id)
    )
    sim = result.scalar_one()
    assert sim.jaccard_similarity == 100.0
    assert sim.relationship == "exact"
    assert sim.shared_files == 2
    assert sim.unique_to_a == 0
    assert sim.unique_to_b == 0


@pytest.mark.asyncio
async def test_compute_similarities_partial_overlap(db_session: AsyncSession):
    scan = Scan(name="Partial", scanner="rmlint", target_paths=["/data"], status="analyzing")
    db_session.add(scan)
    await db_session.flush()

    # dir_a has 3 files, dir_b has 2, with 1 shared
    files = [
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/dir_a/f1.txt", size=100, is_original=True, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="bbb", path="/data/dir_a/f2.txt", size=100, is_original=True, group_id="g2"),
        DuplicateFile(scan_id=scan.id, checksum="ccc", path="/data/dir_a/f3.txt", size=100, is_original=True, group_id="g3"),
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/dir_b/f1.txt", size=100, is_original=False, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="ddd", path="/data/dir_b/f4.txt", size=100, is_original=True, group_id="g4"),
    ]
    db_session.add_all(files)
    await db_session.flush()

    # Jaccard = 1/4 = 25%, below default threshold of 50
    count = await AnalysisService.compute_similarities(db_session, scan.id, threshold=50.0)
    assert count == 0

    # With lower threshold, should find the pair
    count = await AnalysisService.compute_similarities(db_session, scan.id, threshold=20.0)
    assert count == 1

    result = await db_session.execute(
        select(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan.id)
    )
    sim = result.scalar_one()
    assert sim.shared_files == 1
    assert sim.relationship == "overlap"


@pytest.mark.asyncio
async def test_compute_similarities_subset(db_session: AsyncSession):
    scan = Scan(name="Subset", scanner="rmlint", target_paths=["/data"], status="analyzing")
    db_session.add(scan)
    await db_session.flush()

    # dir_a is a subset of dir_b
    files = [
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/dir_a/f1.txt", size=100, is_original=True, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/dir_b/f1.txt", size=100, is_original=False, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="bbb", path="/data/dir_b/f2.txt", size=200, is_original=True, group_id="g2"),
        DuplicateFile(scan_id=scan.id, checksum="ccc", path="/data/dir_b/f3.txt", size=300, is_original=True, group_id="g3"),
    ]
    db_session.add_all(files)
    await db_session.flush()

    # Jaccard = 1/3 = 33%, use low threshold
    count = await AnalysisService.compute_similarities(db_session, scan.id, threshold=30.0)
    assert count == 1

    result = await db_session.execute(
        select(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan.id)
    )
    sim = result.scalar_one()
    assert sim.a_subset_pct == 100.0  # dir_a is fully contained in dir_b
    assert sim.relationship == "subset"


@pytest.mark.asyncio
async def test_compute_similarities_clears_previous(db_session: AsyncSession):
    scan = Scan(name="Clear", scanner="rmlint", target_paths=["/data"], status="analyzing")
    db_session.add(scan)
    await db_session.flush()

    files = [
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/a/f1.txt", size=100, is_original=True, group_id="g1"),
        DuplicateFile(scan_id=scan.id, checksum="aaa", path="/data/b/f1.txt", size=100, is_original=False, group_id="g1"),
    ]
    db_session.add_all(files)
    await db_session.flush()

    count1 = await AnalysisService.compute_similarities(db_session, scan.id, threshold=50.0)
    count2 = await AnalysisService.compute_similarities(db_session, scan.id, threshold=50.0)

    # Should not accumulate - previous records should be cleared
    result = await db_session.execute(
        select(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan.id)
    )
    sims = result.scalars().all()
    assert len(sims) == count2
