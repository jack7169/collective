# Pipeline Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximize scan pipeline speed at 2M+ file scale by leveraging 125GB RAM — orjson parsing, parallel pipeline, zero-reread similarity index, early Jaccard pruning, SQLite tuning, and API consolidation.

**Architecture:** Producer thread parses fclones output (via orjson) and builds in-memory similarity structures while queueing 50k-row insert batches. Consumer thread drains the queue into SQLite. Similarity analysis runs directly from memory, skipping the 2.1M-row re-read. SQLite tuned for 1GB cache + 4GB mmap. Missing indexes added via schema migration.

**Tech Stack:** orjson (Rust JSON parser), Python threading + queue, SQLAlchemy Core bulk insert, SQLite WAL mode

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/requirements.txt` | Python dependencies | Add `orjson` |
| `backend/app/scanners/fclones.py` | fclones output parsing | Replace `json.load` with `orjson.loads` |
| `backend/app/tasks/scan_tasks.py` | Scan pipeline + similarity | Producer/consumer pipeline, in-memory index, Jaccard pruning, Core bulk similarity insert |
| `backend/app/database.py` | SQLite config + migrations | New pragmas, schema v3 with new indexes |
| `backend/app/models/duplicate.py` | DuplicateFile/Dir models | Add 3 new indexes |
| `backend/app/api/results.py` | Results API endpoints | Consolidate scan_stats, single-query tag_originals |
| `backend/app/api/compare.py` | Compare endpoint + cache | Fix tree_cache key, column-level select |
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Keeper selection UI | Debounce suggest-keepers |
| `backend/tests/test_scanners/test_fclones.py` | Scanner tests | Update for orjson |
| `backend/tests/test_tasks/test_scan_tasks.py` | Pipeline tests | Add similarity index + pruning tests |

---

### Task 1: Add orjson Dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add orjson to requirements**

Add `orjson` at the end of `backend/requirements.txt`:

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
sqlalchemy[asyncio]==2.0.41
aiosqlite==0.21.0
alembic==1.15.2
pydantic==2.11.3
pydantic-settings==2.9.1
huey==2.5.2
websockets==15.0.1
python-multipart==0.0.20
httptools==0.6.4
orjson>=3.10
```

- [ ] **Step 2: Install and verify**

Run: `cd backend && pip install orjson && python -c "import orjson; print(orjson.__version__)"`
Expected: Version 3.10+ printed

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "deps: add orjson for fast JSON parsing"
```

---

### Task 2: Replace json.load with orjson in fclones parser

**Files:**
- Modify: `backend/app/scanners/fclones.py:1-2,71-74`
- Test: `backend/tests/test_scanners/test_fclones.py`

- [ ] **Step 1: Write test verifying orjson parse_output works**

Add to `backend/tests/test_scanners/test_fclones.py`:

```python
def test_parse_output_uses_orjson(tmp_path):
    """Verify parse_output works with orjson (same output as json.load)."""
    import orjson
    output_file = tmp_path / "output.json"
    data = {
        "header": {},
        "groups": [
            {
                "hash": "abc123",
                "files": [
                    {"path": "/mnt/user/a/file1.txt", "size": 100, "modified": "2026-01-01T00:00:00"},
                    {"path": "/mnt/user/b/file1.txt", "size": 100, "modified": "2026-01-01T00:00:00"},
                ]
            }
        ]
    }
    output_file.write_bytes(orjson.dumps(data))
    backend = FclonesBackend()
    results = list(backend.parse_output(str(output_file)))
    assert len(results) == 2
    assert results[0].checksum == "abc123"
    assert results[0].is_original is True
    assert results[1].is_original is False
    assert results[0].size == 100
```

- [ ] **Step 2: Run test to verify it passes with current json.load**

Run: `cd backend && python -m pytest tests/test_scanners/test_fclones.py::test_parse_output_uses_orjson -v`
Expected: PASS (the test is format-agnostic — it works with either json or orjson)

- [ ] **Step 3: Replace json with orjson in fclones.py**

In `backend/app/scanners/fclones.py`, replace the import at line 1:

```python
import orjson
```

Remove `import json` from line 1.

Replace the file reading in `parse_output` (lines 72-73):

```python
        with open(output_path, "rb") as f:
            data = orjson.loads(f.read())
```

Note: `orjson.loads` accepts `bytes`, so open in binary mode (`"rb"`) — avoids the UTF-8 decode step that stdlib json performs.

- [ ] **Step 4: Run all fclones tests**

Run: `cd backend && python -m pytest tests/test_scanners/test_fclones.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/scanners/fclones.py backend/tests/test_scanners/test_fclones.py
git commit -m "perf: replace json.load with orjson.loads in fclones parser

orjson (Rust-based) is 5-10x faster than stdlib json for deserialization.
Binary mode read avoids the UTF-8 decode step."
```

---

### Task 3: SQLite Pragma Tuning + New Indexes

**Files:**
- Modify: `backend/app/database.py:10-17,86-137`
- Modify: `backend/app/models/duplicate.py:20-26,36-40`

- [ ] **Step 1: Update SQLite pragmas in database.py**

In `backend/app/database.py`, replace the `_SQLITE_PRAGMAS` list (lines 10-17):

```python
_SQLITE_PRAGMAS = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA foreign_keys=ON",
    "PRAGMA busy_timeout=60000",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA cache_size=-1000000",    # 1GB cache (was 64MB) — leverage available RAM
    "PRAGMA temp_store=MEMORY",
    "PRAGMA mmap_size=4294967296",   # 4GB memory-mapped I/O
]
```

- [ ] **Step 2: Add new indexes to DuplicateFile model**

In `backend/app/models/duplicate.py`, add two indexes to the `DuplicateFile.__table_args__` tuple:

```python
    __table_args__ = (
        Index("ix_duplicate_files_scan_id", "scan_id"),
        Index("ix_duplicate_files_scan_checksum", "scan_id", "checksum"),
        Index("ix_duplicate_files_scan_path", "scan_id", "path"),
        Index("ix_duplicate_files_scan_is_original", "scan_id", "is_original"),
        Index("ix_duplicate_files_scan_group", "scan_id", "group_id"),
        UniqueConstraint("scan_id", "path", name="uq_duplicate_files_scan_path"),
    )
```

- [ ] **Step 3: Add new index to DuplicateDirectory model**

In `backend/app/models/duplicate.py`, add one index to `DuplicateDirectory.__table_args__`:

```python
    __table_args__ = (
        Index("ix_duplicate_dirs_scan_id", "scan_id"),
        Index("ix_duplicate_dirs_scan_group", "scan_id", "group_id"),
        UniqueConstraint("scan_id", "path", name="uq_duplicate_dirs_scan_path"),
    )
```

- [ ] **Step 4: Add schema v3 migration in database.py**

In `backend/app/database.py`, inside the `init_db` function, after the v2 migration block, add:

```python
        if current_version < 3:
            logger.info("Migrating schema to v3: new indexes for performance")
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_files_scan_is_original "
                "ON duplicate_files (scan_id, is_original)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_files_scan_group "
                "ON duplicate_files (scan_id, group_id)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_dirs_scan_group "
                "ON duplicate_directories (scan_id, group_id)"
            ))
            conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '3')"
            ))
            conn.commit()
            logger.info("Schema migrated to v3")
```

- [ ] **Step 5: Run existing tests to verify nothing breaks**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/database.py backend/app/models/duplicate.py
git commit -m "perf: SQLite 1GB cache + 4GB mmap, add 3 missing indexes

cache_size from 64MB to 1GB, add mmap_size=4GB for memory-mapped I/O.
New indexes: (scan_id, is_original) and (scan_id, group_id) on
duplicate_files, (scan_id, group_id) on duplicate_directories.
Schema migration v3 creates indexes on existing databases."
```

---

### Task 4: Producer/Consumer Pipeline + In-Memory Similarity Index

This is the largest task — it restructures the parsing and insert phases of `run_scan_task` and changes `_compute_similarities_sync` to accept pre-built structures.

**Files:**
- Modify: `backend/app/tasks/scan_tasks.py`
- Test: `backend/tests/test_tasks/test_scan_tasks.py`

- [ ] **Step 1: Write test for in-memory similarity index building**

Add to `backend/tests/test_tasks/test_scan_tasks.py`:

```python
from app.tasks.scan_tasks import build_similarity_index
from app.scanners.base import DuplicateFileResult


def test_build_similarity_index_groups_by_parent():
    """Verify in-memory index correctly groups checksums by parent directory."""
    records = [
        DuplicateFileResult(checksum="aaa", path="/mnt/data/dir1/f1.txt", size=100, mtime=None, is_original=True, group_id="g0"),
        DuplicateFileResult(checksum="bbb", path="/mnt/data/dir1/f2.txt", size=200, mtime=None, is_original=False, group_id="g1"),
        DuplicateFileResult(checksum="aaa", path="/mnt/data/dir2/f1.txt", size=100, mtime=None, is_original=False, group_id="g0"),
    ]
    dir_checksums, checksum_to_size, dir_total_size = build_similarity_index(records, abs_depth=None)

    assert dir_checksums["/mnt/data/dir1"] == {"aaa", "bbb"}
    assert dir_checksums["/mnt/data/dir2"] == {"aaa"}
    assert checksum_to_size["aaa"] == 100
    assert checksum_to_size["bbb"] == 200
    assert dir_total_size["/mnt/data/dir1"] == 300
    assert dir_total_size["/mnt/data/dir2"] == 100


def test_build_similarity_index_respects_depth():
    """Verify depth truncation groups deep paths under truncated parent."""
    records = [
        DuplicateFileResult(checksum="aaa", path="/mnt/data/a/b/c/f.txt", size=50, mtime=None, is_original=True, group_id="g0"),
        DuplicateFileResult(checksum="aaa", path="/mnt/data/x/y/z/f.txt", size=50, mtime=None, is_original=False, group_id="g0"),
    ]
    # abs_depth=4 means truncate to /mnt/data/a/b
    dir_checksums, checksum_to_size, dir_total_size = build_similarity_index(records, abs_depth=4)

    assert "/mnt/data/a/b" in dir_checksums
    assert "/mnt/data/x/y" in dir_checksums
    assert "/mnt/data/a/b/c" not in dir_checksums
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_tasks/test_scan_tasks.py::test_build_similarity_index_groups_by_parent tests/test_tasks/test_scan_tasks.py::test_build_similarity_index_respects_depth -v`
Expected: FAIL with `ImportError: cannot import name 'build_similarity_index'`

- [ ] **Step 3: Implement `build_similarity_index` function**

Add this function to `backend/app/tasks/scan_tasks.py` after the `_check_cancelled` function (around line 35):

```python
def build_similarity_index(
    records: list,
    abs_depth: int | None,
) -> tuple[dict[str, set[str]], dict[str, int], dict[str, int]]:
    """Build in-memory similarity structures from parsed file records.

    Returns (dir_checksums, checksum_to_size, dir_total_size).
    Called by the producer thread during parsing to avoid re-reading from DB.
    """
    from collections import defaultdict

    dir_checksums: dict[str, set[str]] = defaultdict(set)
    checksum_to_size: dict[str, int] = defaultdict(int)
    dir_total_size: dict[str, int] = defaultdict(int)

    for rec in records:
        path = rec.path if hasattr(rec, "path") else rec["path"]
        checksum = rec.checksum if hasattr(rec, "checksum") else rec["checksum"]
        size = rec.size if hasattr(rec, "size") else rec["size"]

        parent = path.rsplit("/", 1)[0] if "/" in path else ""
        if abs_depth is not None:
            parts = parent.rstrip("/").split("/")
            if len(parts) > abs_depth:
                parent = "/".join(parts[:abs_depth])

        dir_checksums[parent].add(checksum)
        checksum_to_size[checksum] = size
        dir_total_size[parent] += size

    return dict(dir_checksums), dict(checksum_to_size), dict(dir_total_size)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_tasks/test_scan_tasks.py::test_build_similarity_index_groups_by_parent tests/test_tasks/test_scan_tasks.py::test_build_similarity_index_respects_depth -v`
Expected: PASS

- [ ] **Step 5: Rewrite parsing + insert phases with producer/consumer pipeline**

In `backend/app/tasks/scan_tasks.py`, add `import queue, threading` to the top-level imports (line 1 area).

Replace the entire parsing + insert section (the `if not skip_parsing:` block, approximately lines 328-428) with:

```python
        if not skip_parsing:
            # Parsing phase (60-85% of overall progress)
            scan.status = "parsing"
            scan.interrupted_phase = "parsing"
            scan.progress_percent = 60.0
            scan.progress_message = "Parsing scanner output..."
            session.commit()

            if not os.path.exists(output_path):
                scan.status = "failed"
                scan.error_message = "Scanner output file not found"
                scan.completed_at = datetime.now(timezone.utc)
                session.commit()
                return

            # Clear any previous partial records (for clean resume)
            session.execute(
                delete(DuplicateFile).where(DuplicateFile.scan_id == scan_id)
            )
            session.execute(
                delete(DuplicateDirectory).where(DuplicateDirectory.scan_id == scan_id)
            )
            session.commit()

            # --- Producer/Consumer Pipeline ---
            # Producer: parse output + build similarity index
            # Consumer: bulk insert into SQLite
            # Both run concurrently via threads; queue provides backpressure.

            import queue as _queue
            import threading

            BATCH_SIZE = 50_000
            QUEUE_MAX = 4
            insert_queue: _queue.Queue = _queue.Queue(maxsize=QUEUE_MAX)
            cancel_event = threading.Event()
            producer_error: list[Exception] = []
            consumer_error: list[Exception] = []

            # Compute abs_depth for similarity index
            prefix_depth = 0
            if scan.target_paths and scan.scan_depth is not None and scan.scan_depth > 0:
                min_depth = min(len(p.rstrip("/").split("/")) for p in scan.target_paths)
                prefix_depth = min_depth
            abs_depth = (prefix_depth + scan.scan_depth) if scan.scan_depth is not None and scan.scan_depth > 0 else None

            # Shared counters (written by producer, read by consumer for progress)
            counters = {
                "total_files": 0, "total_size": 0, "duplicates": 0,
                "space_recoverable": 0, "total_inserted": 0,
                "total_to_insert": 0, "unique_dirs": set(),
            }
            counters_lock = threading.Lock()

            # Similarity index structures (built by producer)
            sim_dir_checksums: dict[str, set[str]] = {}
            sim_checksum_to_size: dict[str, int] = {}
            sim_dir_total_size: dict[str, int] = {}

            def producer():
                """Parse output, build similarity index, queue insert batches."""
                try:
                    from collections import defaultdict
                    _dir_checksums: dict[str, set[str]] = defaultdict(set)
                    _checksum_to_size: dict[str, int] = {}
                    _dir_total_size: dict[str, int] = defaultdict(int)

                    file_batch: list[dict] = []
                    dir_batch: list[dict] = []
                    _total_files = 0
                    _total_size = 0
                    _duplicates = 0
                    _space_recoverable = 0
                    _unique_dirs: set[str] = set()

                    for result in backend.parse_output(output_path):
                        if cancel_event.is_set():
                            return

                        if isinstance(result, DuplicateFileResult):
                            file_batch.append({
                                "scan_id": scan_id,
                                "checksum": result.checksum,
                                "path": result.path,
                                "size": result.size,
                                "mtime": result.mtime,
                                "is_original": result.is_original,
                                "group_id": result.group_id,
                            })

                            # Build similarity index in-line
                            parent = result.path.rsplit("/", 1)[0] if "/" in result.path else ""
                            if abs_depth is not None:
                                parts = parent.rstrip("/").split("/")
                                if len(parts) > abs_depth:
                                    parent = "/".join(parts[:abs_depth])
                            _dir_checksums[parent].add(result.checksum)
                            _checksum_to_size[result.checksum] = result.size
                            _dir_total_size[parent] += result.size

                            _total_files += 1
                            _total_size += result.size
                            _unique_dirs.add(parent)
                            if not result.is_original:
                                _duplicates += 1
                                _space_recoverable += result.size

                            if len(file_batch) >= BATCH_SIZE:
                                insert_queue.put(("file", file_batch))
                                file_batch = []

                        elif isinstance(result, DuplicateDirResult):
                            dir_batch.append({
                                "scan_id": scan_id,
                                "group_id": result.group_id,
                                "path": result.path,
                                "file_count": result.file_count,
                                "total_size": result.total_size,
                                "is_original": result.is_original,
                            })
                            _unique_dirs.add(result.path)

                            if len(dir_batch) >= BATCH_SIZE:
                                insert_queue.put(("dir", dir_batch))
                                dir_batch = []

                    # Flush remaining batches
                    if file_batch:
                        insert_queue.put(("file", file_batch))
                    if dir_batch:
                        insert_queue.put(("dir", dir_batch))

                    # Update shared counters
                    with counters_lock:
                        counters["total_files"] = _total_files
                        counters["total_size"] = _total_size
                        counters["duplicates"] = _duplicates
                        counters["space_recoverable"] = _space_recoverable
                        counters["unique_dirs"] = _unique_dirs

                    # Export similarity index
                    nonlocal sim_dir_checksums, sim_checksum_to_size, sim_dir_total_size
                    sim_dir_checksums = dict(_dir_checksums)
                    sim_checksum_to_size = dict(_checksum_to_size)
                    sim_dir_total_size = dict(_dir_total_size)

                except Exception as e:
                    producer_error.append(e)
                finally:
                    insert_queue.put(None)  # Sentinel: producer is done

            def consumer():
                """Drain insert queue into SQLite."""
                try:
                    inserted = 0
                    last_progress_update = time.time()

                    while True:
                        item = insert_queue.get()
                        if item is None:
                            break  # Producer is done

                        if cancel_event.is_set():
                            continue  # Drain queue but don't insert

                        record_type, batch = item
                        if record_type == "file":
                            session.execute(insert(DuplicateFile), batch)
                        else:
                            session.execute(insert(DuplicateDirectory), batch)
                        inserted += len(batch)

                        now = time.time()
                        if now - last_progress_update >= 2:
                            # Check cancellation
                            session.refresh(scan)
                            if scan.status == "cancelled":
                                cancel_event.set()
                                continue

                            with counters_lock:
                                total_to_insert = counters["total_files"]
                            insert_pct = inserted / max(1, total_to_insert)
                            scan.progress_percent = round(65.0 + insert_pct * 20.0, 1)
                            scan.progress_message = f"Inserting records... {inserted:,} / {total_to_insert:,}"
                            scan.total_files = total_to_insert
                            session.commit()
                            last_progress_update = now

                    session.commit()
                    with counters_lock:
                        counters["total_inserted"] = inserted

                except Exception as e:
                    consumer_error.append(e)

            # Start both threads
            prod_thread = threading.Thread(target=producer, name="scan-producer")
            cons_thread = threading.Thread(target=consumer, name="scan-consumer")
            prod_thread.start()
            cons_thread.start()
            prod_thread.join()
            cons_thread.join()

            # Propagate errors
            if producer_error:
                raise producer_error[0]
            if consumer_error:
                raise consumer_error[0]
            if cancel_event.is_set():
                raise ScanCancelled(f"Scan {scan_id} cancelled by user")

            # Update scan stats from counters
            scan.total_files = counters["total_files"]
            scan.total_dirs = len(counters["unique_dirs"])
            scan.total_size = counters["total_size"]
            scan.duplicates_found = counters["duplicates"]
            scan.space_recoverable = counters["space_recoverable"]
```

- [ ] **Step 6: Update `_compute_similarities_sync` to accept pre-built structures**

Replace the function signature and the initial DB-read + grouping section (lines 580-625 approximately) with:

```python
def _compute_similarities_sync(
    session: Session,
    scan_id: int,
    threshold: float,
    depth: int | None,
    target_paths: list[str] | None = None,
    # Pre-built in-memory structures (skip DB read when provided)
    prebuilt_dir_checksums: dict[str, set[str]] | None = None,
    prebuilt_checksum_to_size: dict[str, int] | None = None,
    prebuilt_dir_total_size: dict[str, int] | None = None,
) -> int:
    """Synchronous version of similarity computation for Huey worker."""
    from collections import defaultdict

    t0 = time.time()

    if prebuilt_dir_checksums is not None:
        # Use pre-built in-memory structures (zero re-read path)
        dir_checksums = prebuilt_dir_checksums
        checksum_to_size = prebuilt_checksum_to_size or {}
        dir_total_size = prebuilt_dir_total_size or defaultdict(int)
        logger.info("Similarity: using pre-built index (%d dirs, %d checksums) — skipped DB read",
                    len(dir_checksums), len(checksum_to_size))
    else:
        # Fallback: read from DB (used by run_reanalysis_task)
        stmt = (
            select(DuplicateFile.path, DuplicateFile.checksum, DuplicateFile.size)
            .where(DuplicateFile.scan_id == scan_id)
        )
        rows = session.execute(stmt).all()
        logger.info("Similarity: fetched %d rows in %.1fs", len(rows), time.time() - t0)

        if not rows:
            return 0

        dir_checksums_dd: dict[str, set[str]] = defaultdict(set)
        checksum_to_size = {}
        dir_total_size_dd: dict[str, int] = defaultdict(int)

        prefix_depth = 0
        if target_paths and depth is not None and depth > 0:
            min_depth = min(len(p.rstrip("/").split("/")) for p in target_paths)
            prefix_depth = min_depth
        abs_depth = (prefix_depth + depth) if depth is not None and depth > 0 else None

        for path, checksum, size in rows:
            parent = path.rsplit("/", 1)[0] if "/" in path else ""
            if abs_depth is not None:
                parts = parent.rstrip("/").split("/")
                if len(parts) > abs_depth:
                    parent = "/".join(parts[:abs_depth])

            dir_checksums_dd[parent].add(checksum)
            checksum_to_size[checksum] = size
            dir_total_size_dd[parent] += size

        dir_checksums = dict(dir_checksums_dd)
        dir_total_size = dict(dir_total_size_dd)
        del rows  # Free ~250MB immediately
        logger.info("Similarity: %d directories, grouped in %.1fs", len(dir_checksums), time.time() - t0)

    if not dir_checksums:
        return 0
```

- [ ] **Step 7: Update all references to `dir_sizes` in pair generation**

In the pair generation loop, replace every `dir_sizes[d].get(cksum, 0)` with `checksum_to_size.get(cksum, 0)`. The size lookup becomes:

```python
        cksum_size = checksum_to_size.get(cksum, 0)
```

Replace the old block (around lines 644-655) that finds `cksum_size` by iterating directories:

```python
    for cksum, dirs in checksum_to_dirs.items():
        if len(dirs) < 2 or len(dirs) > 50:
            continue
        dirs_list = list(dirs)
        cksum_size = checksum_to_size.get(cksum, 0)
        for i in range(len(dirs_list)):
            for j in range(i + 1, len(dirs_list)):
                a, b = dirs_list[i], dirs_list[j]
                pair = (a, b) if a <= b else (b, a)
                pair_shared_count[pair] += 1
                pair_shared_size[pair] += cksum_size
```

Remove the `dir_sizes` variable entirely — it is no longer constructed or referenced.

- [ ] **Step 8: Update the caller in `run_scan_task` to pass pre-built structures**

In the analysis phase section (around line 436), update the call to pass the in-memory structures:

```python
        # Analysis phase (85-100%) — clear old similarities if resuming
        scan.status = "analyzing"
        scan.interrupted_phase = "analyzing"
        scan.progress_percent = 85.0
        scan.progress_message = "Computing directory similarities..."
        session.execute(
            delete(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan_id)
        )
        session.commit()

        # Pass pre-built structures if available (from pipeline); otherwise None (reanalysis)
        similarity_count = _compute_similarities_sync(
            session,
            scan_id,
            threshold=scan.similarity_threshold or 50.0,
            depth=scan.scan_depth,
            target_paths=scan.target_paths,
            prebuilt_dir_checksums=sim_dir_checksums if not skip_parsing else None,
            prebuilt_checksum_to_size=sim_checksum_to_size if not skip_parsing else None,
            prebuilt_dir_total_size=sim_dir_total_size if not skip_parsing else None,
        )
```

Note: When `skip_parsing` is True (resume from analyzing phase), the in-memory structures don't exist, so pass `None` to trigger the DB-read fallback.

Also initialize the similarity variables at the top of `run_scan_task` (before the skip_parsing check) so they exist in all code paths:

```python
        sim_dir_checksums: dict[str, set[str]] = {}
        sim_checksum_to_size: dict[str, int] = {}
        sim_dir_total_size: dict[str, int] = {}
```

- [ ] **Step 9: Update Pass 2 rollup to use `checksum_to_size` instead of `dir_sizes`**

In the rollup aggregation loop (the ancestor walk section), replace `dir_sizes[dir_path].get(cksum, 0)` with `checksum_to_size.get(cksum, 0)`:

```python
        for dir_path, checksums in dir_checksums.items():
            parts = dir_path.split("/")
            for depth_idx in range(len(parts), 0, -1):
                ancestor = "/".join(parts[:depth_idx])
                if ancestor in parent_prefixes:
                    for cksum in checksums:
                        size = checksum_to_size.get(cksum, 0)
                        if cksum not in parent_checksums[ancestor] or size > parent_checksums[ancestor][cksum]:
                            parent_checksums[ancestor][cksum] = size
                    parent_total_size[ancestor] += dir_total_size.get(dir_path, 0)
```

- [ ] **Step 10: Run all tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add backend/app/tasks/scan_tasks.py backend/tests/test_tasks/test_scan_tasks.py
git commit -m "perf: producer/consumer pipeline + zero-reread similarity index

Producer thread parses fclones output and builds in-memory similarity
structures. Consumer thread inserts 50k-row batches into SQLite.
Similarity analysis skips the 2.1M-row SELECT entirely when pre-built
structures are available. Replaced dir_sizes dict-of-dicts with flat
checksum_to_size dict."
```

---

### Task 5: Early Jaccard Pruning

**Files:**
- Modify: `backend/app/tasks/scan_tasks.py` — pair generation loop in `_compute_similarities_sync`
- Test: `backend/tests/test_tasks/test_scan_tasks.py`

- [ ] **Step 1: Write test for Jaccard upper-bound pruning**

Add to `backend/tests/test_tasks/test_scan_tasks.py`:

```python
def test_jaccard_pruning_skips_impossible_pairs():
    """Pairs where max possible Jaccard < threshold should be pruned."""
    # dir_a has 100 checksums, dir_b has 1 checksum
    # Even if they share 1 checksum, Jaccard = 1/100 = 1% — below any reasonable threshold
    # The pair should never appear in pair_shared_count

    from collections import defaultdict

    dir_checksums = {
        "/big": {f"ck_{i}" for i in range(100)},
        "/small": {"ck_0"},  # shares 1 checksum with /big
    }
    checksum_to_size = {f"ck_{i}": 100 for i in range(100)}
    dir_total_size = {"/big": 10000, "/small": 100}

    from app.tasks.scan_tasks import _compute_similarities_sync
    from unittest.mock import MagicMock

    session = MagicMock()
    session.execute = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    # Calling with threshold=50 and pre-built structures
    # The /big + /small pair has max Jaccard = 1/100 = 1%, well below 50%
    count = _compute_similarities_sync(
        session, scan_id=1, threshold=50.0, depth=None, target_paths=None,
        prebuilt_dir_checksums=dir_checksums,
        prebuilt_checksum_to_size=checksum_to_size,
        prebuilt_dir_total_size=dir_total_size,
    )
    assert count == 0  # No pairs should pass the threshold
```

- [ ] **Step 2: Run test to verify it passes (baseline — current code already filters by threshold after accumulation)**

Run: `cd backend && python -m pytest tests/test_tasks/test_scan_tasks.py::test_jaccard_pruning_skips_impossible_pairs -v`
Expected: PASS (the test validates the end result, not the optimization path)

- [ ] **Step 3: Add early pruning to pair generation**

In `_compute_similarities_sync`, move the `dir_checksum_counts` computation to BEFORE the pair generation loop, and add the upper-bound check inside the inner loop:

```python
    # Pre-cache set sizes for early Jaccard pruning
    dir_checksum_counts = {d: len(cs) for d, cs in dir_checksums.items()}

    for cksum, dirs in checksum_to_dirs.items():
        if len(dirs) < 2 or len(dirs) > 50:
            continue
        dirs_list = list(dirs)
        cksum_size = checksum_to_size.get(cksum, 0)
        for i in range(len(dirs_list)):
            for j in range(i + 1, len(dirs_list)):
                a, b = dirs_list[i], dirs_list[j]
                # Early Jaccard upper-bound: if the smaller set were entirely
                # shared, the best possible Jaccard is min/max.
                count_a = dir_checksum_counts[a]
                count_b = dir_checksum_counts[b]
                if min(count_a, count_b) * 100 < threshold * max(count_a, count_b):
                    continue
                pair = (a, b) if a <= b else (b, a)
                pair_shared_count[pair] += 1
                pair_shared_size[pair] += cksum_size
```

Note the integer comparison `min * 100 < threshold * max` avoids floating-point division in the hot loop.

Also remove the second `dir_checksum_counts` computation that was after the pair loop (it's now before).

- [ ] **Step 4: Run all tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/tasks/scan_tasks.py backend/tests/test_tasks/test_scan_tasks.py
git commit -m "perf: early Jaccard pruning in pair generation

Skip pair accumulation when upper-bound Jaccard (min/max set sizes)
is below threshold. Uses integer comparison to avoid float division
in hot loop. Replaces sorted() with inline compare-and-swap for O(1)
pair ordering."
```

---

### Task 6: Core Bulk Insert for Similarity Records

**Files:**
- Modify: `backend/app/tasks/scan_tasks.py` — end of `_compute_similarities_sync`

- [ ] **Step 1: Replace ORM add_all with Core bulk insert for similarities**

Find the similarity insert section at the end of `_compute_similarities_sync` (around lines 829-832). Replace:

```python
    # Bulk insert similarities
    batch_size = 1000
    for i in range(0, len(records), batch_size):
        session.add_all(records[i:i + batch_size])
        session.flush()
    session.commit()
```

With:

```python
    # Core bulk insert — bypasses ORM identity map, batch_size=10000
    all_sim_dicts = [{
        "scan_id": scan_id,
        "structural_similarity": None,
        "is_rollup": False,
        **r,
    } for r in all_results]

    if rollup_results:
        for r in rollup_results:
            all_sim_dicts.append({
                "scan_id": scan_id,
                "structural_similarity": None,
                "is_rollup": True,
                **r,
            })

    batch_size = 10_000
    for i in range(0, len(all_sim_dicts), batch_size):
        session.execute(insert(DirectorySimilarity), all_sim_dicts[i:i + batch_size])
    session.commit()

    logger.info("Similarity: inserted %d records (%.1fs total)", len(all_sim_dicts), time.time() - t0)
    return len(all_sim_dicts)
```

Also remove the old `records = [DirectorySimilarity(...) for r in all_results]` list comprehension that built ORM objects — it's no longer needed.

- [ ] **Step 2: Run all tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/tasks/scan_tasks.py
git commit -m "perf: Core bulk insert for similarity records (batch=10k)

Replace ORM add_all + flush (batch=1000) with session.execute(insert(), dicts)
(batch=10000). Same pattern as file/dir inserts."
```

---

### Task 7: Consolidate scan_stats Queries

**Files:**
- Modify: `backend/app/api/results.py` — `scan_stats` endpoint

- [ ] **Step 1: Replace 3 separate count/sum queries with one conditional aggregation**

In `backend/app/api/results.py`, replace the `scan_stats` function body (approximately lines 238-290). Find the three separate queries for total_files, duplicate_count, and recoverable_space and replace them with:

```python
    # Single query for file stats using conditional aggregation
    stats_q = await db.execute(
        select(
            func.count().label("total_files"),
            func.sum(
                case((DuplicateFile.is_original == False, 1), else_=0)  # noqa: E712
            ).label("duplicate_count"),
            func.sum(
                case((DuplicateFile.is_original == False, DuplicateFile.size), else_=0)  # noqa: E712
            ).label("recoverable_space"),
        ).where(DuplicateFile.scan_id == scan_id)
    )
    stats_row = stats_q.one()
    total_files = stats_row.total_files or 0
    duplicate_count = stats_row.duplicate_count or 0
    recoverable_space = stats_row.recoverable_space or 0
```

Add `case` to the sqlalchemy imports at the top of the file:

```python
from sqlalchemy import select, func, update, text, delete, case
```

Keep the top-groups query and similarity-count query as they are — they hit different tables.

- [ ] **Step 2: Run tests**

Run: `cd backend && python -m pytest tests/test_api/ -v`
Expected: All API tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/results.py
git commit -m "perf: consolidate scan_stats from 5 queries to 3

Replace 3 separate COUNT/SUM queries on duplicate_files with one
conditional aggregation using CASE expressions. The new (scan_id,
is_original) index makes this efficient."
```

---

### Task 8: Single-Query tag_originals

**Files:**
- Modify: `backend/app/api/results.py` — `tag_originals` endpoint

- [ ] **Step 1: Replace per-path UPDATE loop with single OR query**

In `backend/app/api/results.py`, find the tagging loop in `tag_originals` (approximately lines 324-338). Replace:

```python
    # Step 2: Mark files under tagged directories as originals
    tag_count = 0
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
        tag_count += result.rowcount
```

With:

```python
    # Step 2: Mark files under tagged directories as originals (single query)
    from sqlalchemy import or_
    path_conditions = [
        DuplicateFile.path.startswith(path.rstrip("/") + "/")
        for path in body.original_paths
    ]
    result = await db.execute(
        update(DuplicateFile)
        .where(
            DuplicateFile.scan_id == scan_id,
            or_(*path_conditions),
        )
        .values(is_original=True)
    )
    tag_count = result.rowcount
```

- [ ] **Step 2: Run tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/results.py
git commit -m "perf: single-query tag_originals instead of N sequential UPDATEs

Collapse per-path UPDATE loop into one UPDATE with OR-joined
startswith conditions. One write lock acquisition instead of N."
```

---

### Task 9: Compare Endpoint Fixes

**Files:**
- Modify: `backend/app/api/compare.py`

- [ ] **Step 1: Fix tree_cache key to include scan_id**

In `backend/app/api/compare.py`, find the tree_diff endpoint where `_tree_cache` key is constructed (around line 291). Change:

```python
cache_key = f"{body.dir_a}:{body.dir_b}:{body.max_depth}"
```

To:

```python
cache_key = f"{scan_id}:{body.dir_a}:{body.dir_b}:{body.max_depth}"
```

- [ ] **Step 2: Switch compare_directories to column-level select**

In `backend/app/api/compare.py`, find the `compare_directories` function's query (around line 61). Replace:

```python
    q = select(DuplicateFile).where(
```

With:

```python
    q = select(
        DuplicateFile.path,
        DuplicateFile.size,
        DuplicateFile.mtime,
        DuplicateFile.checksum,
    ).where(
```

Then update the result iteration to work with named tuples instead of ORM objects. Find where `files` is iterated (around lines 69-82) and update attribute access. The current code likely uses `f.path`, `f.size`, `f.mtime`, `f.checksum` — named tuple rows from column-level select use the same attribute names, so the downstream code should work without changes.

Change the result line from:

```python
    files = result.scalars().all()
```

To:

```python
    files = result.all()
```

(Column-level selects return Row objects, not scalars.)

- [ ] **Step 3: Run tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/compare.py
git commit -m "fix: add scan_id to tree_cache key, column-level select in compare

tree_cache was missing scan_id in the key, causing cross-scan stale
results. compare_directories now selects only 4 columns instead of
full ORM objects, reducing memory and bypassing identity map."
```

---

### Task 10: Suggest-Keepers Debounce

**Files:**
- Modify: `frontend/src/components/results/DuplicateGroupsList.tsx`

- [ ] **Step 1: Add debounce to suggest-keepers mutation**

In `frontend/src/components/results/DuplicateGroupsList.tsx`, add a `useRef` and `setTimeout`-based debounce around the mutation call. Find the `handleSetKeeper` function (around line 66).

At the top of the component, add a ref:

```typescript
const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add `useRef` to the React import if not already present.

In `handleSetKeeper`, replace the direct mutation call (around lines 87-89):

```typescript
    if (allDecisions.length >= 3) {
      suggestMutation.mutate(allDecisions);
    }
```

With:

```typescript
    if (allDecisions.length >= 3) {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = setTimeout(() => {
        suggestMutation.mutate(allDecisions);
      }, 500);
    }
```

- [ ] **Step 2: Verify the dev server runs**

Run: `cd frontend && npm run dev`
Expected: Dev server starts without errors. Test by clicking keeper buttons rapidly — only one API call should fire after a 500ms pause.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DuplicateGroupsList.tsx
git commit -m "perf: debounce suggest-keepers mutation (500ms)

Prevents firing the heavy suggest-keepers query on every single
keeper click. Only fires once after 500ms of no clicks."
```

---

### Task 11: Final Integration Test + Deploy

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# If any unstaged changes remain, stage and commit them
```

- [ ] **Step 4: Deploy to server**

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude=dist --exclude=.venv . root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build --no-cache -f docker/Dockerfile -t collective:latest ."
ssh root@192.168.50.45 "docker stop collective && docker rm collective && docker run -d --name collective --restart unless-stopped -p 8080:8080 -v /mnt/user:/mnt/user -v /mnt/user/appdata/collective:/data collective:latest"
```

- [ ] **Step 5: Verify deployment**

```bash
ssh root@192.168.50.45 "docker logs collective --tail 15 2>&1"
```

Expected: All three processes (fastapi, huey, scheduler) enter RUNNING state. Schema migration v3 log line appears.

- [ ] **Step 6: Test with a scan**

Resume or start a scan and observe:
- Progress bar should show parsing phase completing quickly (orjson)
- Insert phase should overlap with parsing (pipeline)
- Similarity phase should start without a visible "loading rows" delay
- Check Huey logs for timing: `Similarity: using pre-built index ... — skipped DB read`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: pipeline optimization complete — orjson, parallel pipeline, zero-reread similarity, Jaccard pruning, SQLite tuning"
```
