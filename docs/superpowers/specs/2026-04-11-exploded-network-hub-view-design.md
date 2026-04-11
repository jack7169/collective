# Exploded Network — Hub View with Tag & Move Design Spec

**Date:** 2026-04-11

## Problem Statement

The Similar Directories tab shows flat pair cards (dir_a ↔ dir_b). When a directory overlaps with multiple others, it appears in multiple disconnected cards the user must mentally connect. There is no way to see "this directory overlaps with X, Y, and Z" at a glance, and no workflow for extracting a canonical copy to a clean archival structure.

## Design

### 1. Hub Grouping — Frontend Transformation

Backend returns flat `DirectorySimilarity` pairs. Frontend groups them into deduplicated hub cards.

**Algorithm:**
1. Fetch all pairs at once (`per_page=500`, typically <50 results)
2. Build adjacency map: `Map<directory, PeerEntry[]>` — for each pair, add entries under both dir_a and dir_b
3. Score each directory: `score = sum(shared_size × jaccard / 100)` across all its peers (total reclaimable GB)
4. Sort directories by score descending
5. Iterate sorted list. For each directory not yet claimed as a peer, make it a hub. Mark all its peers as claimed.
6. Result: deduplicated list of hubs where each pair appears exactly once. Highest-reclaimable directories become hubs; lower-scoring directories appear only as peers.

**PeerEntry structure:**
```typescript
interface PeerEntry {
  directory: string;
  similarity: number;        // jaccard %
  relationship: string;      // exact/subset/superset/overlap
  sharedFiles: number;
  sharedSize: number;
  uniqueInHub: number;
  uniqueInPeer: number;
  peerFileCount: number;
  peerSize: number;
  originalPair: DirectorySimilarity;  // for Compare nav + DifferencesDropdown
  hubIsA: boolean;                     // whether hub dir is dir_a in the pair
}
```

**DirectoryHub structure:**
```typescript
interface DirectoryHub {
  directory: string;
  fileCount: number;
  totalSize: number;
  peers: PeerEntry[];             // sorted by similarity descending
  totalReclaimable: number;       // sum of peer shared sizes (approx)
}
```

### 2. Hub Card Layout

```
┌─────────────────────────────────────────────────────────┐
│ /mnt/user/CarthageNAS/ssd_combined/Jack Forbes Archive  │  ← Hub directory (monospace, full path)
│ 1,296 files · 468.7 GB · ~890 GB reclaimable           │  ← Stats + reclaimable estimate
│                                      [🛡️ Tag & Move ▾] │  ← Primary action (dropdown: Tag & Move / Skip Move)
├─────────────────────────────────────────────────────────┤
│ Overlaps with 3 directories · 890.2 GB total shared     │  ← Summary
├─────────────────────────────────────────────────────────┤
│ [99.4%] [Exact] Personal Drone Archive  448.0 GB shared │  ← Peer row (click → Compare)
│         1,288 files · 0 unique / 8 unique               │
│         ▶ Show differences                              │  ← DifferencesDropdown (existing component)
│         ┌ Also overlaps with:                     ┐     │  ← Exploded network (expanded)
│         │ [77.3%] .../EUS_backup/...  210.2 GB    │     │
│         └                                         ┘     │
├─────────────────────────────────────────────────────────┤
│ [95.9%] [Subset] OldStorageFolder/Videos  447.8 GB      │  ← Peer row
│         1,251 files · 49 unique / 4 unique              │
├─────────────────────────────────────────────────────────┤
│ [77.3%] [Overlap] EUS_backup/Drone/2022  210.2 GB       │  ← Peer row
│         1,010 files · 154 unique / 4,009 unique         │
└─────────────────────────────────────────────────────────┘
```

**Hub header:**
- Full monospace path, file count, total size
- Reclaimable estimate (sum of peer shared sizes)
- "Tag & Move" button with dropdown for "Skip Move" alternative

**Peer rows (sorted by similarity descending):**
- Similarity badge (color-coded) + relationship badge
- Peer directory path
- Shared size, shared file count
- Unique file counts (hub unique / peer unique)
- DifferencesDropdown (reuse existing component)
- Click row → navigate to Compare view

**Exploded Network:**
- Per peer: expandable inline section showing "Also overlaps with: ..."
- Lists other hubs/pairs this peer appears in (looked up from the full adjacency map)
- Gives network-graph context without leaving the card

### 3. Tag & Move Workflow

The primary action for resolving a hub. Extracts the canonical copy to a clean archival structure and deletes redundant peers.

**Flow:**
1. User clicks **"Tag & Move"** on a hub directory
2. **TagMoveDialog** opens with:
   - Source: hub directory path (read-only)
   - Destination: path picker (reuse existing `PathPicker` component) for target location
   - Preview: "Move `/source/` → `/dest/` and delete 3 peer directories"
   - File list: peers that will be deleted, with sizes
   - Total space freed estimate
3. User confirms → executes:
   - Tags hub as original via `POST /api/scans/{id}/tag-originals`
   - Creates move action for hub directory via `POST /actions`
   - Creates delete action for each peer directory via `POST /actions`
   - Confirms all actions via `POST /actions/{id}/confirm`
4. On success → hub card removed from view, scan stats refresh
5. On error → show error, no partial execution

**"Skip Move" alternative:**
- Dropdown option on the Tag & Move button
- Tags hub as original only (no move, no peer deletion)
- Hub card stays but shows "ORIGINAL" badge

### 4. Sort Options

At hub level:
- **Reclaimable** (default): sort by `totalReclaimable` descending — biggest impact first
- **Peers**: sort by number of peers descending — most connected hubs first
- **Size**: sort by hub directory size descending

### 5. Components

| Component | Action | Notes |
|-----------|--------|-------|
| `DirectoryHubCard.tsx` | Create | Hub card with peer list, tag & move, exploded network |
| `TagMoveDialog.tsx` | Create | Path picker + preview + confirm for tag & move + peer deletion |
| `SimilarDirectoriesTab.tsx` | Modify | Replace pair card loop with hub grouping + hub cards |
| `DifferencesDropdown.tsx` | No change | Reused per peer row |
| `PathPicker.tsx` | No change | Reused in TagMoveDialog for destination selection |
| `TagFloatingBar.tsx` | Remove usage | Replaced by per-hub Tag & Move |
| `DirectoryPairCard.tsx` | Keep | Still used by standalone `/similar` route |

### 6. Data Flow

```
SimilarDirectoriesTab
  │
  ├─ useSimilarDirs(scanId, { per_page: 500 })  →  all pairs
  │
  ├─ groupIntoHubs(pairs)  →  DirectoryHub[]  (frontend transform)
  │   ├─ Build adjacency map
  │   ├─ Score directories by total reclaimable
  │   ├─ Greedy hub selection (highest score first, claim peers)
  │   └─ Sort hubs by totalReclaimable desc
  │
  ├─ DirectoryHubCard (per hub)
  │   ├─ Hub header with Tag & Move button
  │   ├─ Peer rows (click → Compare)
  │   ├─ DifferencesDropdown per peer (lazy-loaded)
  │   └─ Exploded Network per peer (from adjacency map)
  │
  └─ TagMoveDialog (on Tag & Move click)
      ├─ PathPicker for destination
      ├─ Preview: move hub + delete peers
      └─ Execute via POST /actions pipeline
```
