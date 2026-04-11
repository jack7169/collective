# Duplicate Groups "Pick the Keeper" Redesign — Design Spec

**Date:** 2026-04-10
**Branch:** fix/scan-progress-and-results-ui-overhaul

## Problem Statement

The Duplicate Groups UI requires 7 clicks minimum to delete a single duplicate file. The workflow (select files → add to queue → preview → confirm → execute) adds ceremony that makes sense for bulk operations but is overkill for the common case. Selection is buried in per-group dropdown menus, the action queue panel is a separate fixed panel disconnected from the groups, and there's no way to express "keep this one, delete the rest" — the most natural mental model for deduplication.

## Design

### 1. Interaction Model — "Pick the Keeper" in Sandbox Mode

The user works in a sandbox. No filesystem changes happen until explicitly applied. Each duplicate group is a decision: which copy do you want to keep?

**Group card with vertical file list:**
- Each file in a group is a row showing: action badge, full monospace path (word-wrapped), file size, date modified
- Every file has a "Keep" button
- Clicking "Keep" on one file resolves the group:
  - That file gets a green background tint + "KEEP" badge
  - All other files get red background tint, reduced opacity, strikethrough path, "DELETE" badge
  - Card header updates to show reclaimable space
- **Changing your mind**: Click "Keep" on a different file in the same group — it becomes the new keeper, the previous keeper goes back to DELETE state
- **Undo resolution**: Click the KEEP badge on the current keeper to unmark it — group returns to unresolved state (all files neutral, all showing "Keep" buttons)

**Card header** shows:
- File size (all copies are identical bytes)
- Copy count badge (e.g. "5 copies")
- Reclaimable space (shown after resolution, e.g. "saving 1.9 GB" in red)

**Group states:**
- **Unresolved**: No keeper selected. All files show "Keep" buttons. Neutral border.
- **Resolved**: Keeper selected. Green keeper row, red strikethrough delete rows. Green-tinted border.
- **Suggested**: Smart suggestion available but not yet accepted. Suggested keeper has dashed green border + "Suggested" badge. "Accept" button visible. Neutral border with subtle highlight.

### 2. Smart Suggestions — Pattern Learning

After the user manually resolves ~3+ groups, the backend analyzes their decisions to suggest keepers for remaining unresolved groups.

**Pattern detection algorithm:**
1. Collect all user decisions: which file ID was kept in each resolved group
2. Extract the parent directory path of each kept file
3. Count directory prefix frequency — e.g. if 5/5 kept files are under `/mnt/user/ssd_combined/`, that prefix has 100% confidence
4. For each unresolved group, check if exactly one file matches the dominant prefix pattern
5. If a single file matches, suggest it as the keeper with the confidence score

**API endpoint:** `POST /api/scans/{scan_id}/suggest-keepers`

Request body:
```json
{
  "decisions": [
    { "group_checksum": "abc123", "kept_file_id": 42 },
    { "group_checksum": "def456", "kept_file_id": 87 }
  ]
}
```

Response:
```json
{
  "suggestions": [
    {
      "group_checksum": "ghi789",
      "suggested_file_id": 123,
      "confidence": 0.95,
      "reason": "Path matches pattern: /mnt/user/ssd_combined/"
    }
  ],
  "pattern": {
    "preferred_prefix": "/mnt/user/ssd_combined/",
    "match_count": 5,
    "total_decisions": 5
  }
}
```

**Frontend behavior:**
- Suggestions fetched after each manual resolution (debounced)
- Suggested keepers shown inline: dashed green border on the suggested file row, "Suggested" badge, "Accept" button
- Other files in a suggested group remain neutral (no red/strikethrough until accepted)
- User can click "Accept" to resolve with the suggestion, or click "Keep" on a different file to override
- Toolbar shows "Accept all suggestions (N)" button when suggestions exist

### 3. Toolbar

Replaces the current toolbar (sort dropdown + buried selection menu + conditional bulk action buttons).

**Layout:**
```
[Sort: Size ▼]   42 of 203 groups resolved · 89.2 GB reclaimable   [Accept All Suggestions (34)]  [Review & Apply]
```

**Elements:**
- **Sort dropdown**: "Sort by Size" (default) / "Sort by Count" — unchanged from current
- **Progress indicator**: "{resolved} of {total} groups resolved · {reclaimable} reclaimable" — updates live as user picks keepers
- **"Accept All Suggestions (N)"** button: Shown only when suggestions exist. Resolves all suggested groups at once. Count badge shows how many.
- **"Review & Apply"** button: Primary action button. Enabled when at least 1 group is resolved. Opens the review popup.

### 4. Review & Apply Popup

Full-screen dialog that shows the complete impact of all sandbox decisions before committing to disk.

**Summary header:**
```
Keeping 203 files · Deleting 614 files · Reclaiming 142.3 GB
```

**Two-column analysis below the summary:**

**Left column — "Files Being Kept":**
- Grouped by parent directory
- Each directory shows: path, file count, total size
- Expandable to show individual file paths within that directory
- Sorted by file count descending (directories with most kept files first)

**Right column — "Files Being Deleted":**
- Same structure: grouped by parent directory, count + size, expandable
- Sorted by total size descending (biggest deletions first)

**Bottom action bar:**
- "Cancel" button — closes popup, returns to sandbox (no changes lost)
- "Apply to Disk" button (destructive/red styling) — executes all deletions

**Execution flow when "Apply to Disk" is clicked:**
1. For each resolved group, create a delete action for each non-keeper file via `POST /actions` with `action_type: "delete"` and `source_path: file.path`
2. Confirm all actions via `POST /actions/{id}/confirm`
3. Show progress indicator in the popup while actions execute
4. On completion, show success summary with count of deleted files + space reclaimed
5. Invalidate scan stats and duplicate groups queries so UI refreshes to new state

### 5. Components

| Component | Action | Notes |
|-----------|--------|-------|
| `DuplicateGroupCard.tsx` | Rewrite | "Pick the keeper" card with keep/delete visual states |
| `DuplicateGroupsList.tsx` | Rewrite | New toolbar, progress tracking, suggestion integration |
| `useKeeperSelection.ts` | New (replaces `useGroupSelection.ts`) | Tracks keeper decisions per group, resolved/unresolved state, reclaimable space |
| `ReviewApplyDialog.tsx` | New | Full-screen review popup with two-column file analysis |
| `ScanResults.tsx` | Modify | Remove ActionQueuePanel from Duplicate Groups context |
| `suggest-keepers` endpoint | New | Backend pattern detection + suggestion API |

### 6. What Gets Removed

- **`useGroupSelection.ts`** — replaced by `useKeeperSelection.ts`. The old hook tracked individual file selections for bulk operations. The new hook tracks one keeper per group.
- **`ActionQueuePanel.tsx`** usage in ScanResults — the review popup replaces the queue panel for this tab. The component itself stays (may be used elsewhere or for other action types in the future).
- **`useActionQueue.ts`** usage in ScanResults — the review popup handles execution directly. The hook stays available.
- **Bulk action buttons** (Delete/Hardlink/Symlink in toolbar) — replaced by the "pick the keeper" + "Review & Apply" flow. Hardlink/symlink could be added later as an option in the review popup ("Replace duplicates with hardlinks instead of deleting") but is out of scope for this redesign.

### 7. Data Flow

```
DuplicateGroupsList
  │
  ├─ useDuplicateGroups(scanId)  →  GET /api/scans/{id}/duplicate-groups  →  instant (DB)
  │   (page load — group cards with file lists)
  │
  ├─ useKeeperSelection()  →  local state
  │   (tracks: keeperByGroup Map<checksum, fileId>, resolved count, reclaimable bytes)
  │
  ├─ POST /api/scans/{id}/suggest-keepers  →  after manual resolutions
  │   (sends decisions, receives suggestions for remaining groups)
  │
  └─ "Review & Apply" click  →  ReviewApplyDialog
      │
      ├─ Renders two-column analysis from keeper selection state
      │
      └─ "Apply to Disk" click  →  execution
          ├─ POST /actions (per deletion)
          ├─ POST /actions/{id}/confirm (per deletion)
          └─ Invalidate queries → UI refreshes
```
