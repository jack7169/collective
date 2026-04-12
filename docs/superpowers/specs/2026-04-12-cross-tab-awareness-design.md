# Cross-Tab Awareness — Auto-Resolution of Duplicate Files from Directory Decisions

## Context

Collective has two tabs that operate on overlapping data:
- **Similar Directories** — user tags directory hubs as original, marks peers for deletion, sets archive destinations
- **Duplicate Files** — user picks which copy of a duplicate file to keep, others are deleted

These tabs share a sandbox session. Directory-level decisions imply file-level decisions: if `/OldStorage/Photos/` is marked for deletion and `/NewArchive/Photos/` is tagged as original, then any duplicate file group containing copies in both directories has an obvious keeper — the one in the original directory.

Currently the Duplicate Files tab doesn't know about directory decisions. The user must manually resolve groups that are already implied by their directory choices.

## Goal

Auto-resolve duplicate file groups when directory-level sandbox decisions make the keeper obvious. Show clear status indicators per file (original dir, pending delete). Warn on conflicts (keeper in a directory staged for deletion). Reduce manual work in the Duplicate Files tab to only the ambiguous cases.

## Non-Goals

- Moving keeper files to an archive destination (that's the Similar Directories tab's job)
- New sandbox command types (auto-resolution is derived, not stored)
- Backend changes (purely frontend derived state)

---

## Section 1: Auto-Resolution Logic

### Where It Runs

In `DuplicateGroupsList` as a `useMemo`, not in the sandbox `deriveState` reducer. The reducer only has access to commands — it doesn't have the duplicate groups data from the API. The auto-resolution needs both the sandbox derived state AND the group/file data.

### Algorithm

For each duplicate group (a set of files sharing a checksum):

1. Classify each file:
   - **original**: file's path starts with `dir + "/"` for any directory in `session.derived.taggedOriginals` (slash-terminated prefix match to avoid false positives like `/Photos2` matching `/Photos`)
   - **doomed**: file's path starts with `dir + "/"` for any directory in `session.derived.markedForDelete`
   - **neutral**: neither

2. Resolution rules:
   - If exactly one file is in an "original" directory and all others are "doomed" or "neutral" → **auto-resolve** to the original file
   - If multiple files are in "original" directories → **ambiguous**, no auto-resolution (user must pick)
   - If no files are in "original" directories but some are "doomed" → **warn** (no auto-resolution, but show that some copies will be lost)
   - If no files are in "original" or "doomed" directories → **no action** (directory decisions don't affect this group)

3. Manual overrides take precedence:
   - If `session.derived.keepers` already has an entry for this checksum (user manually picked), that wins over auto-resolution
   - Auto-resolution is a suggestion, not a command — it creates no sandbox state

### Output

```typescript
interface AutoResolution {
  fileId: number;       // the auto-resolved keeper
  reason: string;       // e.g., "Keeper is in tagged original: Photos"
}

// Computed per-group, returned as Map<checksum, AutoResolution>
```

### Effective Keeper

For any group, the effective keeper is:
1. Manual `session.derived.keepers.get(checksum)` — if set, this wins
2. `autoResolvedKeepers.get(checksum)?.fileId` — if auto-resolved
3. `undefined` — unresolved, user needs to decide

---

## Section 2: UI Changes

### Per-File Status Badges

Each file in a duplicate group card gets a small status indicator:

| File Location | Badge | Color |
|---|---|---|
| Under a `taggedOriginal` directory | "Original dir" | Green dot |
| Under a `markedForDelete` directory | "Pending delete" | Red dot |
| Neither | No badge | — |

### Auto-Resolved Group Banner

When a group is auto-resolved, show above the file list:

> Auto-resolved — keeper is in tagged original directory `Photos`

Green background tint. The keeper file shows a green check. Non-keeper files are visually subdued (lower opacity). User can override by clicking a different file — this creates a manual `set-keeper` command that takes precedence.

### Conflict Warning

If a user manually picks a keeper whose parent directory is in `markedForDelete`, show an inline amber warning below the file:

> This file's parent directory is staged for deletion. The keeper will be lost unless you remove that action.

Non-blocking — the user might intend to untag the parent later via undo.

### Toolbar Stats Breakdown

Update the resolved count in the toolbar to show the split:

> 42 resolved (28 auto, 14 manual) · 3 remaining

This tells the user how much work the directory decisions saved them.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Add `useAutoResolution` memo, update stats computation, pass auto-resolution data to group cards |
| `frontend/src/components/results/DuplicateGroupCard.tsx` | Add status badges per file, auto-resolved banner, conflict warning |

No new files. No backend changes. No new sandbox command types.
