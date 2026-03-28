import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.duplicate import DuplicateDirectory, DuplicateFile
from app.models.scan import Scan
from app.models.similarity import DirectorySimilarity
from app.schemas.common import PaginatedResponse
from app.schemas.similarity import DirectorySimilarityFilters, DirectorySimilarityResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scans/{scan_id}", tags=["results"])


async def _get_scan_or_404(db: AsyncSession, scan_id: int) -> Scan:
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


@router.get("/duplicate-dirs")
async def list_duplicate_dirs(
    scan_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    await _get_scan_or_404(db, scan_id)

    count_q = select(func.count()).select_from(DuplicateDirectory).where(
        DuplicateDirectory.scan_id == scan_id
    )
    total = (await db.execute(count_q)).scalar()

    q = (
        select(DuplicateDirectory)
        .where(DuplicateDirectory.scan_id == scan_id)
        .order_by(desc(DuplicateDirectory.total_size))
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await db.execute(q)
    dirs = result.scalars().all()

    from pydantic import BaseModel, ConfigDict

    class DuplicateDirectoryResponse(BaseModel):
        model_config = ConfigDict(from_attributes=True)
        id: int
        scan_id: int
        group_id: str
        path: str
        file_count: int
        total_size: int
        is_original: bool

    return PaginatedResponse.create(
        items=[DuplicateDirectoryResponse.model_validate(d) for d in dirs],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/similar-dirs")
async def list_similar_dirs(
    scan_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    min_similarity: float = Query(0.0, ge=0.0, le=100.0),
    sort_by: str = Query("shared_size"),
    sort_order: str = Query("desc"),
    relationship: Optional[str] = Query(None),
    path_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    await _get_scan_or_404(db, scan_id)

    base_filter = [
        DirectorySimilarity.scan_id == scan_id,
        DirectorySimilarity.jaccard_similarity >= min_similarity,
    ]
    if relationship:
        base_filter.append(DirectorySimilarity.relationship == relationship)
    if path_filter:
        base_filter.append(
            (DirectorySimilarity.dir_a.contains(path_filter))
            | (DirectorySimilarity.dir_b.contains(path_filter))
        )

    count_q = select(func.count()).select_from(DirectorySimilarity).where(*base_filter)
    total = (await db.execute(count_q)).scalar()

    allowed_sort_cols = {
        "shared_size": DirectorySimilarity.shared_size,
        "jaccard_similarity": DirectorySimilarity.jaccard_similarity,
        "structural_similarity": DirectorySimilarity.structural_similarity,
        "shared_files": DirectorySimilarity.shared_files,
        "dir_a": DirectorySimilarity.dir_a,
    }
    sort_col = allowed_sort_cols.get(sort_by, DirectorySimilarity.shared_size)
    order = desc(sort_col) if sort_order == "desc" else sort_col.asc()

    q = (
        select(DirectorySimilarity)
        .where(*base_filter)
        .order_by(order)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await db.execute(q)
    sims = result.scalars().all()

    return PaginatedResponse.create(
        items=[DirectorySimilarityResponse.model_validate(s) for s in sims],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/duplicate-groups")
async def list_duplicate_groups(
    scan_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    sort_by: str = Query("size"),
    sort_order: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    """Return duplicate files grouped by checksum, paginated at group level."""
    await _get_scan_or_404(db, scan_id)

    from pydantic import BaseModel as BM, ConfigDict

    class FileInGroup(BM):
        model_config = ConfigDict(from_attributes=True)
        id: int
        path: str
        size: int
        mtime: Optional[float] = None
        is_original: bool

    class DuplicateGroupResponse(BM):
        checksum: str
        group_id: Optional[str] = None
        file_count: int
        total_size: int
        files: list[FileInGroup]

    # Count distinct groups with >1 file
    count_q = (
        select(func.count())
        .select_from(
            select(DuplicateFile.checksum)
            .where(DuplicateFile.scan_id == scan_id)
            .group_by(DuplicateFile.checksum)
            .having(func.count() > 1)
            .subquery()
        )
    )
    total = (await db.execute(count_q)).scalar() or 0

    # Get page of group checksums
    sort_col_map = {
        "size": func.sum(DuplicateFile.size),
        "file_count": func.count(),
    }
    sort_expr = sort_col_map.get(sort_by, func.sum(DuplicateFile.size))
    order = desc(sort_expr) if sort_order == "desc" else sort_expr.asc()

    groups_q = (
        select(
            DuplicateFile.checksum,
            func.count().label("file_count"),
            func.sum(DuplicateFile.size).label("total_size"),
            func.min(DuplicateFile.group_id).label("group_id"),
        )
        .where(DuplicateFile.scan_id == scan_id)
        .group_by(DuplicateFile.checksum)
        .having(func.count() > 1)
        .order_by(order)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    groups_result = await db.execute(groups_q)
    groups = list(groups_result)

    if not groups:
        return PaginatedResponse.create(items=[], total=total, page=page, per_page=per_page)

    # Fetch all files for those checksums in one query
    checksums = [g.checksum for g in groups]
    files_q = (
        select(DuplicateFile)
        .where(
            DuplicateFile.scan_id == scan_id,
            DuplicateFile.checksum.in_(checksums),
        )
        .order_by(desc(DuplicateFile.is_original), DuplicateFile.mtime.asc())
    )
    files_result = await db.execute(files_q)
    all_files = files_result.scalars().all()

    # Group files by checksum
    files_by_checksum: dict[str, list] = {}
    for f in all_files:
        files_by_checksum.setdefault(f.checksum, []).append(f)

    # Build response maintaining group order
    items = []
    for g in groups:
        group_files = files_by_checksum.get(g.checksum, [])
        items.append(DuplicateGroupResponse(
            checksum=g.checksum,
            group_id=g.group_id,
            file_count=g.file_count,
            total_size=g.total_size,
            files=[FileInGroup.model_validate(f) for f in group_files],
        ))

    return PaginatedResponse.create(items=items, total=total, page=page, per_page=per_page)


@router.get("/duplicate-files")
async def list_duplicate_files(
    scan_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    await _get_scan_or_404(db, scan_id)

    count_q = select(func.count()).select_from(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id
    )
    total = (await db.execute(count_q)).scalar()

    q = (
        select(DuplicateFile)
        .where(DuplicateFile.scan_id == scan_id)
        .order_by(desc(DuplicateFile.size))
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await db.execute(q)
    files = result.scalars().all()

    from pydantic import BaseModel, ConfigDict
    from typing import Optional as Opt

    class DuplicateFileResponse(BaseModel):
        model_config = ConfigDict(from_attributes=True)
        id: int
        scan_id: int
        checksum: str
        path: str
        size: int
        mtime: Opt[float] = None
        is_original: bool
        group_id: Opt[str] = None

    return PaginatedResponse.create(
        items=[DuplicateFileResponse.model_validate(f) for f in files],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/stats")
async def scan_stats(scan_id: int, db: AsyncSession = Depends(get_db)):
    scan = await _get_scan_or_404(db, scan_id)

    total_files_q = select(func.count()).select_from(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id
    )
    total_files = (await db.execute(total_files_q)).scalar()

    dupes_q = select(func.count()).select_from(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.is_original == False,  # noqa: E712
    )
    total_dupes = (await db.execute(dupes_q)).scalar()

    recoverable_q = select(func.coalesce(func.sum(DuplicateFile.size), 0)).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.is_original == False,  # noqa: E712
    )
    space_recoverable = (await db.execute(recoverable_q)).scalar()

    top_groups_q = (
        select(
            DuplicateFile.group_id,
            func.count().label("file_count"),
            func.sum(DuplicateFile.size).label("total_size"),
        )
        .where(DuplicateFile.scan_id == scan_id)
        .group_by(DuplicateFile.group_id)
        .order_by(desc("total_size"))
        .limit(10)
    )
    top_groups_result = await db.execute(top_groups_q)
    top_groups = [
        {"group_id": row.group_id, "file_count": row.file_count, "total_size": row.total_size}
        for row in top_groups_result
    ]

    similar_dirs_q = select(func.count()).select_from(DirectorySimilarity).where(
        DirectorySimilarity.scan_id == scan_id
    )
    similar_dirs_count = (await db.execute(similar_dirs_q)).scalar()

    return {
        "scan_id": scan_id,
        "total_files": total_files,
        "total_duplicates": total_dupes,
        "space_recoverable": space_recoverable,
        "similar_directory_pairs": similar_dirs_count,
        "top_groups_by_size": top_groups,
        "scan_status": scan.status,
        "scan_total_files": scan.total_files,
        "scan_total_size": scan.total_size,
    }


# --- Post-scan tagging: mark directories as originals ---


class TagOriginalsRequest(BaseModel):
    """Tag directories as originals. Files under these paths are marked as
    'keeper' copies — everything else with the same checksum becomes a
    duplicate. The backend re-classifies is_original on all duplicate_files
    and recomputes recoverable space stats."""
    original_paths: list[str]


@router.post("/tag-originals")
async def tag_originals(
    scan_id: int,
    body: TagOriginalsRequest,
    db: AsyncSession = Depends(get_db),
):
    scan = await _get_scan_or_404(db, scan_id)
    if scan.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail="Scan must be completed before tagging originals",
        )

    # Step 1: Reset all files to non-original
    await db.execute(
        update(DuplicateFile)
        .where(DuplicateFile.scan_id == scan_id)
        .values(is_original=False)
    )

    # Step 2: Mark files under tagged paths as originals
    # For each checksum group, the first file found under an original path
    # is the original; all others are duplicates
    tagged_count = 0
    for path in body.original_paths:
        path_prefix = path.rstrip("/") + "/"
        result = await db.execute(
            update(DuplicateFile)
            .where(
                DuplicateFile.scan_id == scan_id,
                DuplicateFile.path.startswith(path_prefix),
            )
            .values(is_original=True)
        )
        tagged_count += result.rowcount

    # Step 3: For checksum groups that have NO original yet (none of
    # their files fall under a tagged path), pick the first file as original
    # so every group has at least one
    all_checksums_q = (
        select(DuplicateFile.checksum)
        .where(DuplicateFile.scan_id == scan_id)
        .group_by(DuplicateFile.checksum)
        .having(func.count() > 1)
    )
    checksum_result = await db.execute(all_checksums_q)
    all_checksums = [row[0] for row in checksum_result]

    for cksum in all_checksums:
        # Check if this group already has an original
        has_original_q = select(func.count()).where(
            DuplicateFile.scan_id == scan_id,
            DuplicateFile.checksum == cksum,
            DuplicateFile.is_original == True,  # noqa: E712
        )
        has_original = (await db.execute(has_original_q)).scalar()
        if has_original == 0:
            # Pick the first file as original
            first_q = (
                select(DuplicateFile.id)
                .where(
                    DuplicateFile.scan_id == scan_id,
                    DuplicateFile.checksum == cksum,
                )
                .order_by(DuplicateFile.id)
                .limit(1)
            )
            first = (await db.execute(first_q)).scalar()
            if first:
                await db.execute(
                    update(DuplicateFile)
                    .where(DuplicateFile.id == first)
                    .values(is_original=True)
                )

    # Step 4: Recompute scan stats
    dupes_q = select(func.count()).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.is_original == False,  # noqa: E712
    )
    total_dupes = (await db.execute(dupes_q)).scalar()

    recoverable_q = select(func.coalesce(func.sum(DuplicateFile.size), 0)).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.is_original == False,  # noqa: E712
    )
    space_recoverable = (await db.execute(recoverable_q)).scalar()

    scan.duplicates_found = total_dupes
    scan.space_recoverable = space_recoverable
    scan.tagged_paths = body.original_paths

    await db.commit()

    return {
        "tagged_paths": body.original_paths,
        "files_tagged_as_original": tagged_count,
        "total_duplicates": total_dupes,
        "space_recoverable": space_recoverable,
    }


@router.get("/tagged-originals")
async def get_tagged_originals(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    scan = await _get_scan_or_404(db, scan_id)
    return {
        "tagged_paths": scan.tagged_paths or [],
    }
