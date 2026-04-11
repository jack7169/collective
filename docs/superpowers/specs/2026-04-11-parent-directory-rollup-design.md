# Parent-Level Directory Rollup — Design Spec

**Date:** 2026-04-11

## Problem Statement

The similarity analysis compares directories at the leaf level where files live. When multiple sibling directories under a common parent all overlap with corresponding siblings under another parent, the user sees 10+ separate pairs instead of one comparison at the parent level.

Example: `.../Itunes/Movies`, `.../Itunes/Backup`, `.../Itunes/MobileSync` each show 100% overlap with `.../Old 5TB Drive/Itunes/Movies`, etc. The user wants to see one comparison: `.../Itunes/ ↔ .../Old 5TB Drive/Itunes/` with the true aggregated overlap.

## Design: Two-Pass Similarity Analysis

### Pass 1 (existing)

Compute leaf-level directory pairs as today. Store in `DirectorySimilarity`.

### Pass 2 (new): Detect Sibling Clusters and Compute Parent Pairs

After pass 1 completes:

1. **Group leaf pairs by parent directories:**
   - For each computed pair `(dir_a, dir_b)`, extract `(parent_of(dir_a), parent_of(dir_b))`
   - Build a map: `(parent_a, parent_b) → list of child pairs`

2. **Detect structural copies:**
   - If a `(parent_a, parent_b)` grouping has **3 or more** child pairs, it's a structural copy
   - Skip if `parent_a == parent_b` (same directory)
   - Skip if a pair `(parent_a, parent_b)` already exists from pass 1 (already computed at that level)

3. **Compute parent-level similarity:**
   - For each detected cluster, query all `DuplicateFile` rows where `path` starts with `parent_a/` and `parent_b/`
   - Compute Jaccard from checksum overlap (same algorithm as leaf pairs)
   - Compute all metrics: `shared_files`, `shared_size`, `a_subset_pct`, `b_subset_pct`, `unique_to_a`, `unique_to_b`, `relationship`

4. **Store as DirectorySimilarity rows:**
   - New `is_rollup` boolean column, set to `True` for parent-level pairs
   - Leaf pairs that were rolled up keep `is_rollup = False`
   - Both coexist in the database

### Schema Change

Add `is_rollup` column to `DirectorySimilarity`:

```python
# In backend/app/models/similarity.py
is_rollup = Column(Boolean, default=False, nullable=False)
```

Add migration in `init_db()`:

```python
("directory_similarities", "is_rollup", "BOOLEAN DEFAULT 0"),
```

### Frontend Changes

In `frontend/src/lib/groupHubs.ts`, when building hubs:
- If rollup pairs exist, prefer them over their child pairs
- Filter out leaf pairs whose `(parent_a, parent_b)` has a corresponding rollup pair
- The rollup pair becomes the hub entry with true aggregated stats

Detection logic:
```
For each pair where is_rollup = false:
  Check if there exists a pair where is_rollup = true
    AND the rollup's dir_a is a prefix of this pair's dir_a
    AND the rollup's dir_b is a prefix of this pair's dir_b
  If so, suppress this leaf pair (the rollup covers it)
```

### API Change

Add `is_rollup` to the `DirectorySimilarityResponse` schema so the frontend can distinguish rollup pairs from leaf pairs.

### What Changes

| Component | Change |
|-----------|--------|
| `backend/app/models/similarity.py` | Add `is_rollup` boolean column |
| `backend/app/database.py` | Add migration for `is_rollup` column |
| `backend/app/tasks/scan_tasks.py` | Add pass 2 after existing similarity computation |
| `backend/app/schemas/similarity.py` | Add `is_rollup` to response schema |
| `frontend/src/api/types.ts` | Add `is_rollup` to `DirectorySimilarity` interface |
| `frontend/src/lib/groupHubs.ts` | Filter leaf pairs that have rollup parents |

### Data Flow

```
Pass 1: Compute leaf-level pairs (existing)
  ↓
Pass 2: Group by (parent_a, parent_b)
  → Clusters with 3+ child pairs detected
  → Query DuplicateFile for each parent pair
  → Compute Jaccard at parent level
  → Store as DirectorySimilarity(is_rollup=True)
  ↓
API returns all pairs (leaf + rollup)
  ↓
Frontend groupHubs.ts filters: prefer rollups, suppress covered leaves
  ↓
DirectoryHubCard shows rolled-up pairs with true stats
```
