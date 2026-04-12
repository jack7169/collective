# Scan Pipeline Optimization — Speed-First Design

## Context

The Collective scan pipeline processes 2.1M duplicate files across 207K directories on an Unraid NAS with 125GB RAM. The current pipeline has several bottlenecks that make large scans slow:

- **Parsing**: stdlib `json.load` takes 5-10s for a 200MB fclones output file
- **Insert**: Serial — parsing must complete before any inserts begin
- **Similarity analysis**: Re-reads all 2.1M rows from SQLite that were just written; pair generation has no early pruning; unbounded intermediate dict sizes
- **Database**: 64MB page cache on a 125GB RAM machine; missing indexes on hot query paths
- **API**: Redundant queries, N sequential UPDATEs, ORM overhead on bulk operations

## Goal

Minimize wall-clock time for the full scan pipeline (parse → insert → analyze) at 2M+ file scale, leveraging 125GB available RAM for speed.

## Non-Goals

- Memory reduction (we have 125GB — spend it freely)
- Frontend rewrite (only the suggest-keepers debounce changes frontend code)
- Scanner (fclones) tuning (disk I/O bound, not fixable in Python)

---

## Section 1: Parsing — orjson + Parallel Pipeline

### 1.1 Replace `json` with `orjson`

**File:** `backend/app/scanners/fclones.py` — `parse_output` method

Replace `json.load(f)` with `orjson.loads(f.read())`. orjson is a Rust-based JSON parser that is 5-10x faster than CPython's stdlib json for deserialization. It returns standard Python dicts and lists — no API changes needed downstream.

Add `orjson` to `backend/requirements.txt`.

### 1.2 Producer/Consumer Thread Pipeline

**File:** `backend/app/tasks/scan_tasks.py` — parsing + insert phases

Replace the serial parse-all-then-insert-all flow with a two-thread pipeline:

**Producer thread:**
- Iterates `backend.parse_output(output_path)`
- Accumulates records into batches of 50,000 dicts
- For each record, simultaneously builds in-memory similarity structures (Section 2)
- Puts completed batches onto a `queue.Queue(maxsize=4)`
- Also tracks `total_files`, `total_size`, `duplicates`, `space_recoverable` counters

**Consumer thread:**
- Takes batches off the queue
- Calls `session.execute(insert(DuplicateFile), batch)` for file records
- Calls `session.execute(insert(DuplicateDirectory), batch)` for dir records
- Updates scan progress every 2 seconds
- Calls `_check_cancelled(session, scan)` between batches

**Main thread:**
- Starts both threads
- Waits for both to complete via `thread.join()`
- Checks for errors propagated via a shared exception holder

**Queue sizing:** `maxsize=4` — each batch is ~20MB (50k dicts × ~400 bytes). 4 slots = 80MB max queue depth. If the consumer (SQLite I/O) is slower than the producer (orjson), the producer blocks on `queue.put()` — natural backpressure.

**Cancellation:** Both threads check a shared `threading.Event`. The `_check_cancelled` function sets the event if the scan status is cancelled. The producer checks it between batches. The consumer checks it between inserts.

**Dir records:** Accumulated separately by the producer (they're a small fraction of total records). After the producer finishes, the remaining dir records are put on the queue as a final batch.

---

## Section 2: Zero Re-reads — In-Memory Similarity Index

### 2.1 Build Index During Parse

**File:** `backend/app/tasks/scan_tasks.py` — producer thread + `_compute_similarities_sync`

Currently Phase 4 starts with `SELECT path, checksum, size FROM duplicate_files WHERE scan_id = ?` to load all 2.1M rows back from SQLite, then builds `dir_checksums`, `dir_sizes`, and `dir_total_size` dicts. This is the single most wasteful step — reading back data we just wrote.

The producer thread already processes every record. While building insert batches, it simultaneously builds:

- `dir_checksums: dict[str, set[str]]` — parent directory → set of checksums
- `checksum_to_size: dict[str, int]` — checksum → file size (flat, not per-directory)
- `dir_total_size: dict[str, int]` — parent directory → total bytes

The depth truncation logic (`abs_depth` computation from `target_paths` and `scan_depth`) runs in the producer, same as it does today in the similarity function.

### 2.2 Replace `dir_sizes` with `checksum_to_size`

**Current:** `dir_sizes: dict[str, dict[str, int]]` — O(F) total entries (one per file record). At 2.1M files, this is ~225MB with high per-dict overhead.

**New:** `checksum_to_size: dict[str, int]` — O(C) entries (one per unique checksum). Since all copies of a duplicate have the same size, we only need one entry per checksum. For a dataset with ~3x average duplication, C ≈ 700K — a 3x reduction in entries and elimination of nested dict overhead.

Used in pair generation for `cksum_size` lookup and in Pass 2 rollup for shared-size computation.

### 2.3 Updated `_compute_similarities_sync` Signature

```python
def _compute_similarities_sync(
    session: Session,
    scan_id: int,
    threshold: float,
    depth: int | None,
    target_paths: list[str] | None,
    # Pre-built in-memory structures (skip DB read when provided)
    dir_checksums: dict[str, set[str]] | None = None,
    checksum_to_size: dict[str, int] | None = None,
    dir_total_size: dict[str, int] | None = None,
) -> int:
```

When the pre-built structures are provided, the function skips the SELECT query and grouping loop entirely, jumping straight to `checksum_to_dirs` construction and pair generation. When `None` (e.g., called from `run_reanalysis_task`), it falls back to the current DB-read path.

---

## Section 3: Early Jaccard Pruning

### 3.1 Upper-Bound Pre-filter

**File:** `backend/app/tasks/scan_tasks.py` — pair generation loop in `_compute_similarities_sync`

Move `dir_checksum_counts = {d: len(cs) for d, cs in dir_checksums.items()}` before the pair generation loop (currently computed after).

Inside the inner loop, before accumulating into `pair_shared_count`:

```python
count_a = dir_checksum_counts[dirs_list[i]]
count_b = dir_checksum_counts[dirs_list[j]]
# Upper bound on Jaccard: if the smaller set were entirely shared,
# the best possible Jaccard is min/max * 100
if min(count_a, count_b) / max(count_a, count_b) * 100 < threshold:
    continue
```

This is a single division per pair — O(1). Pairs where one directory has 10 files and the other has 10,000 can never reach 10% Jaccard and are skipped immediately.

### 3.2 O(1) Pair Ordering

Replace `dirs_list = sorted(dirs)` (O(K log K) per checksum) with inline compare-and-swap inside the pair loop:

```python
pair = (a, b) if a <= b else (b, a)
```

This ensures canonical key ordering without sorting the entire directory list. The `sorted()` call was done to make pair keys deterministic, but pairwise comparison achieves the same result.

**Note:** Since we still need to iterate all pairs from the dirs set, convert it to a list (unsorted) once. The pair ordering is handled per-pair, not per-checksum.

---

## Section 4: SQLite Tuning

### 4.1 Pragma Changes

**File:** `backend/app/database.py` — `_SQLITE_PRAGMAS` list

```python
"PRAGMA cache_size=-1000000",   # 1GB (was 64MB) — keeps hot pages in RAM
"PRAGMA mmap_size=4294967296",  # 4GB — OS page cache serves reads without syscalls
```

Both apply to both engines (async API + sync Huey) since they share the pragma list.

`synchronous=NORMAL` stays unchanged — it's already the right trade-off for WAL mode.

### 4.2 New Indexes

**File:** `backend/app/models/duplicate.py`

```python
# On DuplicateFile:
Index("ix_duplicate_files_scan_is_original", "scan_id", "is_original"),
Index("ix_duplicate_files_scan_group", "scan_id", "group_id"),

# On DuplicateDirectory:
Index("ix_duplicate_dirs_scan_group", "scan_id", "group_id"),
```

These accelerate:
- `scan_stats`: 3 queries filter on `(scan_id, is_original)` — currently full partition scan
- `list_duplicate_groups`: GROUP BY group_id — currently unindexed sort
- Per-group directory lookups

**Not adding** a covering index for the similarity loader — the zero-re-read design (Section 2) eliminates the query entirely.

### 4.3 Schema Migration

New indexes are added via the existing `init_db` schema versioning mechanism in `database.py`. Bump `schema_version`, add `CREATE INDEX IF NOT EXISTS` statements. Runs once on startup, safe for existing databases.

---

## Section 5: API Query Consolidation

### 5.1 `scan_stats`: 5 Queries → 2

**File:** `backend/app/api/results.py` — `scan_stats` endpoint

Replace three separate COUNT/SUM queries with one conditional aggregation:

```sql
SELECT COUNT(*) as total,
       SUM(CASE WHEN is_original = 0 THEN 1 ELSE 0 END) as duplicates,
       SUM(CASE WHEN is_original = 0 THEN size ELSE 0 END) as recoverable
FROM duplicate_files WHERE scan_id = ?
```

The top-groups query and similarity count remain separate — total 3 queries instead of 5. The new `(scan_id, is_original)` index makes the conditional aggregation efficient.

### 5.2 `tag_originals`: N UPDATEs → 1

**File:** `backend/app/api/results.py` — `tag_originals` endpoint

Replace the per-path loop with a single UPDATE using OR-joined conditions:

```python
from sqlalchemy import or_
conditions = [DuplicateFile.path.startswith(p.rstrip("/") + "/") for p in body.original_paths]
await db.execute(
    update(DuplicateFile)
    .where(DuplicateFile.scan_id == scan_id, or_(*conditions))
    .values(is_original=True)
)
```

One write lock acquisition instead of N.

### 5.3 Similarity Insert: ORM → Core Bulk

**File:** `backend/app/tasks/scan_tasks.py` — end of `_compute_similarities_sync`

Replace:
```python
records = [DirectorySimilarity(..., **r) for r in all_results]
session.add_all(records[i:i + 1000])
```

With:
```python
result_dicts = [{..., **r} for r in all_results]
session.execute(insert(DirectorySimilarity), result_dicts[i:i + 10000])
```

Same pattern as file/dir inserts. Batch size increased from 1,000 to 10,000.

---

## Section 6: Compare Endpoint & Cache Fixes

### 6.1 `_tree_cache` Correctness Fix

**File:** `backend/app/api/compare.py`

Add `scan_id` to the cache key. Current key: `f"{dir_a}:{dir_b}:{max_depth}"`. New key: `f"{scan_id}:{dir_a}:{dir_b}:{max_depth}"`. One-line change. Also update `clear_caches_for_scan` to clear matching `_tree_cache` entries.

### 6.2 Column-Level Select in Compare

**File:** `backend/app/api/compare.py` — `compare_directories`

Replace `select(DuplicateFile)` (full ORM object) with column-level select:

```python
select(DuplicateFile.path, DuplicateFile.size, DuplicateFile.mtime, DuplicateFile.checksum)
```

Eliminates ORM identity map overhead. The compare response only uses these four fields.

### 6.3 Suggest-Keepers Debounce

**File:** `frontend/src/components/results/DuplicateGroupsList.tsx`

Add a 500ms debounce to the `suggestMutation.mutate()` call. If the user clicks 5 keepers in quick succession, only one API call fires after the last click.

---

## Files Changed

| File | Changes |
|---|---|
| `backend/app/scanners/fclones.py` | `orjson.loads` instead of `json.load` |
| `backend/app/tasks/scan_tasks.py` | Producer/consumer pipeline, in-memory similarity index, Jaccard pruning, Core bulk similarity insert |
| `backend/app/database.py` | `cache_size=1GB`, `mmap_size=4GB`, schema version bump with new indexes |
| `backend/app/models/duplicate.py` | 3 new indexes |
| `backend/app/api/results.py` | Consolidated scan_stats, single-query tag_originals |
| `backend/app/api/compare.py` | tree_cache scan_id fix, column-level select |
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Suggest-keepers debounce |
| `backend/requirements.txt` | Add `orjson` |

## Expected Impact at 2.1M Files / 207K Dirs

| Phase | Before | After | Speedup |
|---|---|---|---|
| Parse (JSON) | 5-10s | <1s | 5-10x |
| Insert | Serial after parse | Overlapped with parse | Wall-clock ~halved |
| Similarity DB read | 2.1M row SELECT (~10-30s) | Eliminated | Infinite (skipped) |
| Pair generation | Unbounded accumulation | 50-80% pairs pruned by Jaccard upper bound | 2-5x |
| Similarity insert | ORM add_all, batch=1000 | Core bulk, batch=10000 | 3-5x |
| scan_stats API | 5 queries | 2 queries | ~2x |
| tag_originals API | N queries | 1 query | Nx |
| All DB reads | 64MB cache, no mmap | 1GB cache + 4GB mmap | Significant for hot paths |
