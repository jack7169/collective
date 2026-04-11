import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.duplicate import DuplicateFile
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

    # Step 3: For checksum groups that have NO original yet, pick the
    # lowest-ID file as original — single SQL instead of per-checksum loop
    from sqlalchemy import text as sa_text
    await db.execute(
        sa_text("""
            UPDATE duplicate_files
            SET is_original = 1
            WHERE id IN (
                SELECT MIN(df.id)
                FROM duplicate_files df
                LEFT JOIN duplicate_files df_orig
                    ON df_orig.scan_id = df.scan_id
                    AND df_orig.checksum = df.checksum
                    AND df_orig.is_original = 1
                WHERE df.scan_id = :scan_id
                GROUP BY df.checksum
                HAVING COUNT(df.id) > 1
                    AND COUNT(df_orig.id) = 0
            )
        """),
        {"scan_id": scan_id},
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


class KeeperDecisionItem(BaseModel):
    group_checksum: str
    kept_file_id: int


class SuggestKeepersRequest(BaseModel):
    decisions: list[KeeperDecisionItem]


class SuggestedKeeperItem(BaseModel):
    group_checksum: str
    suggested_file_id: int
    confidence: float
    reason: str


class SuggestKeepersResponse(BaseModel):
    suggestions: list[SuggestedKeeperItem]
    pattern: Optional[dict] = None


@router.post("/suggest-keepers")
async def suggest_keepers(
    scan_id: int,
    body: SuggestKeepersRequest,
    db: AsyncSession = Depends(get_db),
):
    """Analyze user keeper decisions and suggest keepers for remaining groups."""
    await _get_scan_or_404(db, scan_id)

    if len(body.decisions) < 3:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    # Fetch the kept files to extract their paths
    kept_ids = [d.kept_file_id for d in body.decisions]
    result = await db.execute(
        select(DuplicateFile).where(
            DuplicateFile.scan_id == scan_id,
            DuplicateFile.id.in_(kept_ids),
        )
    )
    kept_files = {f.id: f for f in result.scalars().all()}

    # Extract directory prefixes from kept files
    import os
    prefix_counts: dict[str, int] = {}
    for decision in body.decisions:
        f = kept_files.get(decision.kept_file_id)
        if not f:
            continue
        parent = os.path.dirname(f.path)
        parts = parent.split("/")
        for i in range(2, len(parts) + 1):
            prefix = "/".join(parts[:i])
            prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1

    if not prefix_counts:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    # Find the most specific prefix that matches most decisions
    total = len(body.decisions)
    best_prefix = ""
    best_score = 0.0
    for prefix, count in prefix_counts.items():
        score = (count / total) * len(prefix)
        if count >= 2 and score > best_score:
            best_prefix = prefix
            best_score = score

    if not best_prefix:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    match_count = prefix_counts[best_prefix]
    confidence = match_count / total

    # Find unresolved groups and suggest keepers
    decided_checksums = {d.group_checksum for d in body.decisions}

    groups_q = (
        select(
            DuplicateFile.checksum,
            func.count().label("cnt"),
        )
        .where(DuplicateFile.scan_id == scan_id)
        .group_by(DuplicateFile.checksum)
        .having(func.count() > 1)
    )
    groups_result = await db.execute(groups_q)
    all_checksums = {row.checksum for row in groups_result}
    undecided = all_checksums - decided_checksums

    if not undecided:
        return SuggestKeepersResponse(
            suggestions=[],
            pattern={
                "preferred_prefix": best_prefix,
                "match_count": match_count,
                "total_decisions": total,
            },
        )

    # Fetch files for undecided groups
    files_q = select(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.checksum.in_(undecided),
    )
    files_result = await db.execute(files_q)
    files_by_checksum: dict[str, list] = {}
    for f in files_result.scalars().all():
        files_by_checksum.setdefault(f.checksum, []).append(f)

    # For each undecided group, see if exactly one file matches the pattern
    suggestions = []
    for checksum, files in files_by_checksum.items():
        matching = [f for f in files if f.path.startswith(best_prefix + "/")]
        if len(matching) == 1:
            suggestions.append(SuggestedKeeperItem(
                group_checksum=checksum,
                suggested_file_id=matching[0].id,
                confidence=confidence,
                reason=f"Path matches pattern: {best_prefix}/",
            ))

    return SuggestKeepersResponse(
        suggestions=suggestions,
        pattern={
            "preferred_prefix": best_prefix,
            "match_count": match_count,
            "total_decisions": total,
        },
    )
