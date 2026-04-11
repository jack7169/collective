# Similar Directories UI Overhaul — Design Spec

**Date:** 2026-04-10
**Branch:** fix/scan-progress-and-results-ui-overhaul

## Problem Statement

The Similar Directories page has four issues that make it unusable for its intended workflow (scan → identify keepers → tag originals → take action):

1. **Path truncation**: Directory paths use `max-w-[200px]` (~25 characters), rendering them indistinguishable for paths sharing long prefixes like `/mnt/user/CarthageNAS/ssd_combined/...`.
2. **Tag Originals disconnected from data**: The "Tag Originals" button opens a PathPicker file browser, forcing users to navigate a directory tree to find paths they're already looking at in the table.
3. **Exact Duplicates tab empty**: Backend populates Exact Duplicates using byte similarity ≥99% (`shared_size / max_size`), but Similar Directories labels pairs "exact" based on Jaccard (checksum overlap) ≥99%. Different metrics cause confusing mismatch — 100% Jaccard pairs don't appear in Exact Duplicates.
4. **Compare view ~10s blank screen**: `useTreeDiff` fires a live `os.scandir` walk up to 5 levels deep over the network. The DB query (`useCompare`) is instant but the entire view blocks on both.

## Design

### 1. Similar Directories Page — Card-Based Layout

**Replace the 9-column table with a card list.** Each directory pair renders as a full card.

#### Card Structure

```
┌─────────────────────────────────────────────────────────────┐
│ [99.9%] [Exact]  1,247 shared files · 449.7 GB   Click → │  ← Stats bar
├────────────────────────────┬────────────────────────────────┤
│ DIRECTORY A                │ DIRECTORY B                    │
│ /mnt/user/CarthageNAS/    │ /mnt/user/CarthageNAS/        │
│ ssd_combined/Drones/FPV/  │ ssd_combined/Jack Forbes       │
│ Tiny Wing V2/             │ Drone Footage Archive/...      │  ← Full paths,
│ 1,251 files · 471.0 GB    │ 1,286 files · 488.7 GB        │    word-wrapped
│ A in B: 99.7%             │ B in A: 96.2%                  │
│ [🛡️ Mark as Original]     │ [🛡️ Mark as Original]          │  ← Inline tagging
├────────────────────────────┴────────────────────────────────┤
│ ▶ Show differences — 4 unique to A · 39 unique to B       │  ← Collapsible
└─────────────────────────────────────────────────────────────┘
```

**Stats bar** (top of card):
- Jaccard similarity badge (color-coded by value)
- Relationship type badge (Exact/Subset/Superset/Overlap)
- Shared file count and shared size
- "Click to compare →" hint (right-aligned)

**Directory panels** (side-by-side, equal width):
- Label: "DIRECTORY A" / "DIRECTORY B" (uppercase, muted)
- Full path in monospace, `word-break: break-all` — no truncation
- Metadata: file count, total size, subset percentage (A in B / B in A)
- "Mark as Original" button — click toggles this directory as tagged original
  - When tagged: green background tint, "ORIGINAL" badge, button shows "✓ Tagged as Original"
  - Tag state is directory-based, not pair-based — tagging `/mnt/user/X` in one card highlights it in every card where that path appears
  - Buttons use `event.stopPropagation()` so they don't trigger card navigation

**Click behavior**: Clicking anywhere on the card (outside buttons/dropdown) navigates to the Compare view for that pair.

#### Differences Dropdown

Collapsible section at the bottom of each card. Collapsed by default, showing summary counts: "4 unique to A · 39 unique to B".

**Data source**: Lazy-loaded from `GET /compare?scan_id={id}&dir_a={a}&dir_b={b}` on first expand. This endpoint already returns `only_in_a` and `only_in_b` arrays with filename, path, size, mtime, and checksum.

**Expanded content**:

```
┌─────────────────────────────────────────────────────────────┐
│ → B appears to be a newer version of A                     │  ← Verdict banner
│   B has 39 files not in A, all newer than A's latest       │
├────────────────────────────┬────────────────────────────────┤
│ 4 FILES ONLY IN A          │ 39 FILES ONLY IN B            │
│                    16.3 MB │                       17.8 GB │
│ DJI_0384_old.mp4 22-08-18 │ DJI_0512_sun.mp4   24-03-20  │
│ notes_draft.txt  22-06-10 │ DJI_0513_can.mp4   24-03-20  │
│ thumb_cache.db   22-09-01 │ DJI_0514_riv.mp4   24-03-21  │
│ .DS_Store        23-01-12 │ DJI_0515_mist.mp4  24-03-22  │
│                            │ DJI_0516_bch.mp4   24-04-02  │
│                            │ [Load more...]                │
│ Range: 22-06-10→23-01-12  │ Range: 24-03-20→24-04-02     │
├────────────────────────────┴────────────────────────────────┤
│                    [Merge B → A]  [Open Full Compare]      │
└─────────────────────────────────────────────────────────────┘
```

**Verdict banner** — auto-determined from file dates:
- **"B is a newer version of A"** (or vice versa): When all unique files on one side have mtimes newer than the other side's latest unique file
- **"Merge recommended"**: When both sides have unique files with overlapping date ranges
- **"Identical — safe to remove either copy"**: When there are no unique files on either side (0 and 0)

**File list rendering**:
- Show first 10 files per side
- "Load more" button appends next 10 (client-side pagination over already-fetched data)
- Each row: filename (monospace) + date modified (right-aligned)
- Date range summary below each list

**Action buttons** (bottom of dropdown):
- Contextual based on verdict: "Merge B → A" / "Merge A → B" / "Merge Both"
- "Open Full Compare" always available

#### Floating Action Bar

When one or more directories are tagged as original, a fixed-position bar appears at the bottom of the viewport:

```
┌─────────────────────────────────────────────────────────────┐
│ 🛡️ 3 directories tagged as original    [Clear] [Apply]    │
└─────────────────────────────────────────────────────────────┘
```

- Shows count of tagged directories
- "Clear All" button resets all tags
- "Apply Tags & Recalculate" button calls `POST /api/scans/{id}/tag-originals` with the tagged paths
- Disappears after successful apply (or when no tags are pending)

#### Retained Elements

- **Filter bar**: Similarity threshold slider, Sort By dropdown, Relationship dropdown — unchanged
- **Pagination**: 25 cards per page, Previous/Next buttons — unchanged
- **Page header**: Title + description — updated to remove "Tag Originals" button (replaced by inline tagging)

#### Removed Elements

- **PathPicker component** — no longer used on this page (may still be used elsewhere)
- **"Tag Originals" toggle button** and its collapsible panel
- **Table layout** — entirely replaced by cards

### 2. Remove Exact Duplicates Tab

The "Exact Duplicates" tab on the ScanResults page is removed. The Similar Directories card view with the Relationship filter set to "Exact" fully replaces its functionality — and does so more accurately (same Jaccard-based "exact" definition, no byte-similarity mismatch).

**Files affected**:
- `frontend/src/pages/ScanResults.tsx` — remove the "Exact Duplicates" TabsContent and its imports
- `frontend/src/api/results.ts` — remove `useDuplicateDirs` hook (dead code)
- `frontend/src/api/types.ts` — remove `DuplicateDirectory` type if unused elsewhere
- `backend/app/api/results.py` — remove `list_duplicate_dirs` endpoint (dead code)
- `backend/app/tasks/scan_tasks.py` — remove the DuplicateDirectory population logic in the similarity analysis phase (lines ~628-664)
- `backend/app/models/duplicate.py` — keep `DuplicateDirectory` model for now (migration to drop table can be a follow-up)

### 3. Compare View — Progressive Loading

The Compare view (`DirectoryCompare.tsx`) currently shows "Loading comparison..." until both `useCompare` (DB, instant) and `useTreeDiff` (filesystem, ~10s) resolve.

**Fix**: Render in two phases.

**Phase 1 — Instant (from `useCompare` DB data)**:
- Summary stat cards (Shared / Only in A / Only in B counts + sizes)
- Warning banner for unique files
- Action buttons (Merge, Dry Run, Assimilate, Bookmark, Skip)
- Shared/unique file lists (already available from the compare response)

**Phase 2 — Progressive (from `useTreeDiff` filesystem data)**:
- Directory tree comparison panel
- While loading: show skeleton/shimmer placeholder with "Loading directory tree..." text
- When loaded: populate the tree as it does today

**Implementation**: The two hooks already fire in parallel. The only change is in the render logic — check `useCompare` loading state separately from `useTreeDiff`, and render Phase 1 content as soon as `useCompare` resolves.

## Data Flow

```
Card view (SimilarDirectories.tsx)
  │
  ├─ useSimilarDirs()  →  GET /api/scans/{id}/similar-dirs  →  instant (DB)
  │   (page load — cards with stats, paths, tag buttons)
  │
  ├─ useCompare()  →  GET /compare?scan_id=...&dir_a=...&dir_b=...  →  instant (DB)
  │   (lazy — on "Show differences" dropdown expand)
  │
  ├─ useTagOriginals()  →  POST /api/scans/{id}/tag-originals  →  on "Apply"
  │
  └─ Card click  →  navigate to /scans/{id}/compare?a=...&b=...
      │
      ├─ useCompare()  →  Phase 1: instant render
      └─ useTreeDiff()  →  Phase 2: progressive tree loading
```

## Components

| Component | Action | Notes |
|-----------|--------|-------|
| `SimilarDirectories.tsx` | Rewrite | Table → card layout, inline tagging, differences dropdown |
| `DirectoryPairCard.tsx` | New | Extracted card component for a single pair |
| `DifferencesDropdown.tsx` | New | Collapsible unique files viewer with lazy loading |
| `TagFloatingBar.tsx` | New | Fixed-position action bar for pending tags |
| `DirectoryCompare.tsx` | Modify | Two-phase rendering (instant DB + progressive tree) |
| `ScanResults.tsx` | Modify | Remove Exact Duplicates tab |
| `PathPicker.tsx` | No change | Remove from SimilarDirectories imports, keep component (used elsewhere) |
| `results.ts` (hooks) | Modify | Remove `useDuplicateDirs`, keep all others |
| `results.py` (backend) | Modify | Remove `list_duplicate_dirs` endpoint |
| `scan_tasks.py` (backend) | Modify | Remove DuplicateDirectory population logic |
