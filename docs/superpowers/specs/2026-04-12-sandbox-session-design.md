# Sandbox Session — Unified Undo/Redo with Atomic Commit

## Context

Collective's scan results UI has multiple decision points scattered across tabs — hub promotion, tag originals, pick keepers, assimilate staging, Tag & Move. Currently each has its own persistence model: some are local React state (lost on refresh), some write to the DB immediately, and Tag & Move writes to disk on click with no undo. There is no unified history, no undo/redo, and no way to see the aggregate effect of decisions before committing.

## Goal

Every user decision across all tabs of a scan accumulates as a reversible command in a single sandbox session. Nothing touches disk until the user explicitly commits. Full undo/redo. A real-time "Map" visualization shows the aggregate effect — old directories being removed flowing into the new archive structure. Sessions persist to the backend so users can switch between scans without losing work. Commit is atomic: all-or-nothing with rollback on failure.

## Non-Goals

- Multi-user collaboration on the same session
- Git-style branching undo (linear undo/redo approved)
- Three.js / WebGL rendering (React Flow covers the 2D graph use case)
- Changing any existing backend action execution logic (we translate commands into existing API calls)

---

## Section 1: Command Types

Every user decision is a serializable plain object. The command list is the single source of truth for the sandbox.

```typescript
type SandboxCommand =
  // Similar Directories tab
  | { type: "promote-hub"; peerDir: string }
  | { type: "tag-original"; directory: string }
  | { type: "untag-original"; directory: string }
  | { type: "mark-delete"; directory: string; reason: string }
  | { type: "unmark-delete"; directory: string }
  | { type: "set-move-dest"; sourceDir: string; destDir: string }
  
  // Duplicate Files tab
  | { type: "set-keeper"; checksum: string; fileId: number }
  | { type: "clear-keeper"; checksum: string }
  | { type: "accept-suggestion"; checksum: string; fileId: number }
  | { type: "accept-all-suggestions"; suggestions: Array<{ checksum: string; fileId: number }> }
  
  // Assimilate (launched from hub peer click)
  | { type: "stage-assimilate-op"; sessionKey: string; op: AssimilateOp }
  | { type: "unstage-assimilate-op"; sessionKey: string; opIndex: number }
```

Commands are data, not functions — serializable to JSON for localStorage and backend persistence. No do/undo handler pairs; state is always derived by replaying the active command list.

### What This Replaces

- `useKeeperSelection` hook — deleted. Keeper state derived from sandbox commands.
- `useActionQueue` hook — no longer needed. Actions are staged as sandbox commands.
- `ReviewApplyDialog` — deleted. Commit happens via the Session Summary Bar.
- `TagMoveDialog` — becomes a command builder. Stages `set-move-dest` + `mark-delete` commands instead of calling APIs directly.

---

## Section 2: Command Stack and Derived State

### The Hook: `useSandboxSession`

A React context provider that holds the command stack and exposes derived state.

```typescript
interface SandboxSession {
  scanId: string;
  sessionId: number | null;       // backend session ID (null until first save)
  commands: SandboxCommand[];     // the source of truth
  cursor: number;                 // active commands = commands[0..cursor)
  
  // Derived state (recomputed via useMemo when commands/cursor change)
  derived: {
    promotedHubs: Set<string>;
    taggedOriginals: Set<string>;
    markedForDelete: Map<string, string>;   // dir -> reason
    moveDestinations: Map<string, string>;  // sourceDir -> destDir
    keepers: Map<string, number>;           // checksum -> fileId
    assimilateOps: Map<string, AssimilateOp[]>;  // sessionKey -> ops
  };
  
  // Actions
  execute: (cmd: SandboxCommand) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  
  // Session management
  commit: () => Promise<void>;
  discard: () => Promise<void>;
  commandCount: number;
  hasChanges: boolean;
}
```

### Undo/Redo Mechanics (Linear)

- `execute(cmd)`: Appends command at cursor position, discards anything after cursor, increments cursor.
- `undo()`: Decrements cursor. Command remains in the list but is inactive.
- `redo()`: Increments cursor. Command becomes active again.
- Active commands = `commands.slice(0, cursor)`.

### Derived State Computation

A `useMemo` depending on `commands` and `cursor` runs a reducer over the active commands:

- `promote-hub` -> adds to `promotedHubs` set
- `tag-original` -> adds to `taggedOriginals`; `untag-original` -> removes
- `mark-delete` -> adds to `markedForDelete`; `unmark-delete` -> removes
- `set-keeper` -> sets in `keepers` map; `clear-keeper` -> deletes
- `set-move-dest` -> sets in `moveDestinations` map
- `accept-suggestion` -> sets in `keepers` (same as set-keeper)
- `accept-all-suggestions` -> iterates and sets each in `keepers`
- `stage-assimilate-op` -> appends to session's ops list; `unstage-assimilate-op` -> removes by index

Components read from `derived` — they never access the raw command list.

### Persistence: Hybrid localStorage + Backend

**localStorage** acts as a write-ahead buffer for instant responsiveness:
- On every command change, `commands` + `cursor` are written to `localStorage` under key `sandbox:scan:{scanId}`.
- Undo/redo is instant — no network round-trip.

**Backend** provides durable persistence:
- Every command change triggers a debounced (2 second) `PUT /sandbox/{sessionId}` that saves commands + cursor.
- On page load, frontend calls `GET /scans/{id}/sandbox`. If a session exists, it's restored. Frontend compares localStorage timestamp vs backend `updated_at` and takes the newer one.
- First command on a fresh scan auto-creates a session via `POST /scans/{id}/sandbox`.

---

## Section 3: Session Overview — "The Map"

A dedicated visualization accessible from any tab showing the aggregate effect of all sandbox commands as a directed node graph: source directories on the left, archive structure on the right, with animated flow lines connecting them.

### Layout

**Left side — "Removing"**:
- Tree of all directories marked for deletion (from `mark-delete` commands)
- Each node shows: path, size, file count, reason for deletion
- Directories tagged as original are visually distinct — they're moving, not being destroyed

**Right side — "Creating"**:
- Tree of move destinations (from `set-move-dest` commands)
- New directories (from PathPicker mkdir) appear as "will be created" nodes
- Files being kept (from `set-keeper` commands) grouped under parent paths

**Center — Flow lines**:
- Animated connections from source to destination for move operations
- Color-coded: green for moves, red for deletes, blue for keeper selections

**Bottom — Session Summary Bar** (always visible):
- Stats: "X directories removed, Y files kept, Z.Z GB freed, N commands"
- Undo/Redo buttons with command count
- "Commit Session" button — the single commit point
- "Discard" button — clears the session

### Interactions

- Click node -> navigates to the relevant hub card or duplicate group
- Right-click node -> context menu: untag, unmark delete, change destination
- Hover edge -> tooltip with operation details
- Drag to rearrange (layout adjustments are visual only, not persisted as commands)

### Empty State

Before any commands: "Start making decisions in the Similar Directories or Duplicate Files tabs. Your changes will appear here as a plan before anything touches disk."

---

## Section 4: Rendering Approach

### Engine: React Flow (@xyflow/react v12)

Purpose-built for interactive node-graph UIs in React. Handles pan/zoom, animated edges, custom node rendering, minimap, and auto-layout. Integrates with Tailwind and shadcn/ui components render natively inside nodes.

### Visual Language

Inspired by Unifi network topology, Tailscale node graphs, and Plotly's interactive data visualization.

- **Nodes**: Rounded cards with frosted-glass backdrop (`bg-card/80 backdrop-blur`), subtle border glow for state:
  - Green glow = original/keeping
  - Red glow = marked for deletion
  - Blue glow = moving to archive
  - Neutral = untouched (context)
- **Edges**: Animated dashed lines with directional flow particles (React Flow `animated` prop). Color matches operation type.
- **Layout**: Dagre auto-layout (left-to-right flow). Source directories on left, destinations on right. Sibling nodes grouped under parent containers.
- **Motion**: Spring-based transitions when commands add/remove nodes. Nodes slide in/out, edges animate connections. React Flow + framer-motion for enter/exit animations.
- **Dark-first**: Uses existing Tailwind dark theme CSS variables. Nodes: `bg-card`, edges: `stroke-primary/40`, glow: `shadow-[0_0_15px_rgba(var(--primary),0.15)]`.
- **Minimap**: Bottom-right corner, shows full graph at reduced scale for orientation on large sessions.
- **Zoom levels**: Zoomed out = compact labels (directory name + size). Zoomed in = full path, file counts, operation badges, action buttons.

---

## Section 5: Atomic Commit Flow

When the user clicks "Commit Session", the sandbox translates its command list into API calls. This is the only moment anything touches disk. **Commit is all-or-nothing: either everything succeeds or everything rolls back.**

### Phase 1 — Dry Run (reversible, no disk changes)

1. Translate all commands into action objects
2. Call `POST /actions` for each (status: "planned")
3. Call `POST /actions/{id}/dry-run` for each — validates paths, permissions, disk space
4. If any dry run fails -> abort, delete all planned actions, report failures to user. User fixes in sandbox and retries.

### Phase 2 — Execute Atomically

1. Call `POST /sandbox/{sessionId}/commit` with the list of action IDs from Phase 1
2. Backend executes in a single Huey task, sequentially in dependency order:
   a. Create directories (mkdir for new destinations)
   b. Tag originals (POST /tag-originals)
   c. Move originals to archive destinations
   d. Apply keeper decisions (delete non-keeper files)
   e. Delete marked directories
   f. Execute assimilate sessions
3. If any operation fails -> backend rolls back all completed operations in reverse order
4. Task returns either "all succeeded" or "all rolled back + error details"

### Execution Order Rationale

We never delete a directory until its contents exist somewhere else (the archive copy). This makes rollback possible — if step (e) fails, we can restore from the archive copies created in step (c).

### Rollback Strategy

Rollback reverses the execution order:
- Re-create deleted directories (from the archive copy that was moved in step c)
- Move originals back to their source locations
- Remove created directories
- Reset tag-originals to previous state

### If Rollback Fails

The task logs exactly what succeeded and what couldn't be rolled back. Sets status to `failed_partial`. The UI shows a detailed recovery report: "these files are at X, these were supposed to be at Y." The user has full visibility into the state.

### Cancel Mid-Commit

Not supported as a user action. Once commit starts, it either fully succeeds or fully rolls back. The UI shows a non-dismissable progress overlay. This prevents the partial-state problem.

### Progress UI During Commit

The Map transitions to "committing" mode:
- Progress overlay shows each phase (dry run -> executing)
- Nodes animate from "planned" (blue outline) to "executing" (pulsing) to "done" (green check) or "rolled back" (amber)
- On success: localStorage session cleared, scan data invalidated, Map shows all nodes in "completed" state
- On rollback: Map shows what was attempted, what rolled back, error details. Session remains active for the user to adjust and retry.

---

## Section 6: Backend Persistence

### New Model: `SandboxSession`

```python
class SandboxSession(Base):
    __tablename__ = "sandbox_sessions"
    
    id = Column(Integer, primary_key=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=True)           # optional user-given name
    commands = Column(JSON, nullable=False)         # serialized command list
    cursor = Column(Integer, nullable=False)        # undo/redo position
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index("ix_sandbox_sessions_scan_id", "scan_id"),
    )
```

### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/scans/{id}/sandbox` | GET | Load active session for a scan (returns latest by updated_at) |
| `/scans/{id}/sandbox` | POST | Create a new session |
| `/sandbox/{session_id}` | PUT | Save commands + cursor (debounced from frontend) |
| `/sandbox/{session_id}` | DELETE | Discard session |
| `/sandbox/{session_id}/commit` | POST | Atomic commit: accepts action IDs, executes with rollback |

### Session Lifecycle

1. User opens scan -> `GET /scans/{id}/sandbox`
2. Session exists -> restore commands + cursor
3. No session -> blank state. First command triggers `POST /scans/{id}/sandbox`
4. Every command change -> debounced (2s) `PUT /sandbox/{session_id}`
5. Commit -> `POST /sandbox/{session_id}/commit` executes, deletes session on success
6. Discard -> `DELETE /sandbox/{session_id}`

Each scan has at most one active session. `POST /scans/{id}/sandbox` returns the existing session if one exists (idempotent). `GET /scans/{id}/sandbox` returns the single active session or 404. The dashboard can show a badge for scans with active sessions.

---

## Section 7: Component Architecture

### New Files

| File | Responsibility | Est. Lines |
|---|---|---|
| `frontend/src/hooks/useSandboxSession.ts` | Command stack, derived state, undo/redo, persistence (localStorage + backend). React context provider. | ~400 |
| `frontend/src/lib/sandboxCommands.ts` | Command type definitions, derive-state reducer, command serialization/validation. | ~150 |
| `frontend/src/api/sandbox.ts` | React Query hooks for sandbox CRUD: `useSandboxSession`, `useSaveSandbox`, `useCommitSandbox`. | ~80 |
| `frontend/src/components/results/SessionMap.tsx` | The Map visualization: React Flow canvas, Dagre layout, node/edge construction from derived state. | ~300 |
| `frontend/src/components/results/SessionMapNodes.tsx` | Custom React Flow node components: DirectoryNode, FileGroupNode, DestinationNode, NewDirNode. | ~200 |
| `frontend/src/components/results/SessionSummaryBar.tsx` | Bottom bar: stats, undo/redo buttons, commit/discard buttons. Docked at bottom of Map and available as floating bar on other tabs. | ~80 |
| `frontend/src/components/results/CommitProgressOverlay.tsx` | Non-dismissable overlay during commit: phase indicators, per-node status animation, error/rollback display. | ~150 |
| `backend/app/models/sandbox.py` | `SandboxSession` SQLAlchemy model. | ~25 |
| `backend/app/api/sandbox.py` | CRUD endpoints + commit endpoint. | ~120 |
| `backend/app/tasks/session_tasks.py` | Huey task for atomic commit: sequential execution + rollback logic. | ~200 |

### Modified Files

| File | Change |
|---|---|
| `frontend/src/pages/ScanResults.tsx` | Add Map as a tab or floating panel. Show session summary bar. Remove direct tag-originals mutation calls. |
| `frontend/src/components/layout/Layout.tsx` | Wrap scan routes with `SandboxSessionProvider` (scanId from URL) so it's shared across ScanResults and AssimilateDuplicates pages. |
| `frontend/src/components/results/SimilarDirectoriesTab.tsx` | Read `promotedHubs`, `taggedOriginals`, `markedForDelete` from sandbox context. Call `session.execute()` instead of API mutations. Remove local `promotedHubs` state. |
| `frontend/src/components/results/DirectoryHubCard.tsx` | "Tag & Move" stages commands instead of opening execution dialog. Add "Mark for Delete" on peer rows. Promote button calls `session.execute({ type: "promote-hub" })`. |
| `frontend/src/components/results/TagMoveDialog.tsx` | Becomes a command builder. PathPicker selects destination, "Confirm" stages `set-move-dest` + `mark-delete` commands. No API calls. |
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Read `keepers` from sandbox context. Call `session.execute({ type: "set-keeper" })`. Remove suggest-keepers trigger from here (move to sandbox-aware wrapper). |
| `frontend/src/pages/AssimilateDuplicates.tsx` | Stage/unstage operations via sandbox commands instead of direct API calls. |
| `frontend/src/pages/Dashboard.tsx` | Show badge on scans with active sandbox sessions. |
| `backend/app/main.py` | Register sandbox router. Import and mount `sandbox.router`. |
| `backend/app/database.py` | Schema v4 migration: create `sandbox_sessions` table. |
| `frontend/package.json` | Add `@xyflow/react` (React Flow v12), `dagre` (graph layout). |

### Deleted Files

| File | Reason |
|---|---|
| `frontend/src/hooks/useKeeperSelection.ts` | Replaced by sandbox session derived state. |
| `frontend/src/components/results/ReviewApplyDialog.tsx` | Replaced by commit flow in SessionSummaryBar + CommitProgressOverlay. |

---

## Files Changed Summary

**Frontend new**: 7 files (~1,360 lines)
**Frontend modified**: 7 files
**Frontend deleted**: 2 files
**Backend new**: 3 files (~345 lines)
**Backend modified**: 2 files
**New dependency**: `@xyflow/react`, `dagre`
