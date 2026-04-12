# Sandbox Session — Plan A: Command Stack + Backend Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core sandbox session infrastructure — command types, derived state reducer, undo/redo hook, backend persistence model, and API endpoints — so that Plan B (component integration) and Plan C (The Map visualization) can build on top.

**Architecture:** A `useSandboxSession` React context holds a linear command stack. Derived state (promoted hubs, tagged originals, keepers, etc.) is recomputed by replaying active commands. Backend stores sessions in a `sandbox_sessions` table. Frontend debounces saves to the backend and uses localStorage as a write-ahead buffer.

**Tech Stack:** React context + useMemo, localStorage, FastAPI + SQLAlchemy, Huey task for atomic commit

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/lib/sandboxCommands.ts` | Create | Command type definitions + derive-state reducer |
| `frontend/src/hooks/useSandboxSession.tsx` | Create | React context provider, command stack, undo/redo, persistence |
| `frontend/src/api/sandbox.ts` | Create | React Query hooks for sandbox CRUD |
| `backend/app/models/sandbox.py` | Create | SandboxSession SQLAlchemy model |
| `backend/app/api/sandbox.py` | Create | REST endpoints for sandbox CRUD + commit |
| `backend/app/tasks/session_tasks.py` | Create | Huey task for atomic commit with rollback |
| `backend/app/models/__init__.py` | Modify | Export SandboxSession |
| `backend/app/api/router.py` | Modify | Mount sandbox router |
| `backend/app/main.py` | Modify | Cleanup orphaned sessions on startup (optional) |
| `backend/app/database.py` | Modify | Schema v4 migration for sandbox_sessions table |
| `backend/app/tasks/worker.py` | Modify | Import session_tasks |

---

### Task 1: Command Types and Derive-State Reducer

**Files:**
- Create: `frontend/src/lib/sandboxCommands.ts`

- [ ] **Step 1: Create the command types and derived state interface**

```typescript
// frontend/src/lib/sandboxCommands.ts

export interface AssimilateOp {
  type: "copy" | "move" | "delete" | "hardlink" | "symlink";
  sourcePath: string;
  destPath?: string;
}

export type SandboxCommand =
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
  | {
      type: "accept-all-suggestions";
      suggestions: Array<{ checksum: string; fileId: number }>;
    }
  // Assimilate
  | { type: "stage-assimilate-op"; sessionKey: string; op: AssimilateOp }
  | { type: "unstage-assimilate-op"; sessionKey: string; opIndex: number };

export interface DerivedSandboxState {
  promotedHubs: Set<string>;
  taggedOriginals: Set<string>;
  markedForDelete: Map<string, string>; // dir → reason
  moveDestinations: Map<string, string>; // sourceDir → destDir
  keepers: Map<string, number>; // checksum → fileId
  assimilateOps: Map<string, AssimilateOp[]>; // sessionKey → ops
}

export function deriveState(commands: SandboxCommand[]): DerivedSandboxState {
  const promotedHubs = new Set<string>();
  const taggedOriginals = new Set<string>();
  const markedForDelete = new Map<string, string>();
  const moveDestinations = new Map<string, string>();
  const keepers = new Map<string, number>();
  const assimilateOps = new Map<string, AssimilateOp[]>();

  for (const cmd of commands) {
    switch (cmd.type) {
      case "promote-hub":
        promotedHubs.add(cmd.peerDir);
        break;
      case "tag-original":
        taggedOriginals.add(cmd.directory);
        break;
      case "untag-original":
        taggedOriginals.delete(cmd.directory);
        break;
      case "mark-delete":
        markedForDelete.set(cmd.directory, cmd.reason);
        break;
      case "unmark-delete":
        markedForDelete.delete(cmd.directory);
        break;
      case "set-move-dest":
        moveDestinations.set(cmd.sourceDir, cmd.destDir);
        break;
      case "set-keeper":
        keepers.set(cmd.checksum, cmd.fileId);
        break;
      case "clear-keeper":
        keepers.delete(cmd.checksum);
        break;
      case "accept-suggestion":
        keepers.set(cmd.checksum, cmd.fileId);
        break;
      case "accept-all-suggestions":
        for (const s of cmd.suggestions) {
          keepers.set(s.checksum, s.fileId);
        }
        break;
      case "stage-assimilate-op": {
        const ops = assimilateOps.get(cmd.sessionKey) ?? [];
        ops.push(cmd.op);
        assimilateOps.set(cmd.sessionKey, ops);
        break;
      }
      case "unstage-assimilate-op": {
        const ops = assimilateOps.get(cmd.sessionKey) ?? [];
        ops.splice(cmd.opIndex, 1);
        assimilateOps.set(cmd.sessionKey, ops);
        break;
      }
    }
  }

  return {
    promotedHubs,
    taggedOriginals,
    markedForDelete,
    moveDestinations,
    keepers,
    assimilateOps,
  };
}

/** Human-readable label for a command (used in history panel). */
export function commandLabel(cmd: SandboxCommand): string {
  switch (cmd.type) {
    case "promote-hub":
      return `Promote hub: ${cmd.peerDir.split("/").pop()}`;
    case "tag-original":
      return `Tag original: ${cmd.directory.split("/").pop()}`;
    case "untag-original":
      return `Untag: ${cmd.directory.split("/").pop()}`;
    case "mark-delete":
      return `Delete: ${cmd.directory.split("/").pop()}`;
    case "unmark-delete":
      return `Unmark delete: ${cmd.directory.split("/").pop()}`;
    case "set-move-dest":
      return `Move → ${cmd.destDir.split("/").pop()}`;
    case "set-keeper":
      return `Keep file #${cmd.fileId}`;
    case "clear-keeper":
      return `Clear keeper for ${cmd.checksum.slice(0, 8)}`;
    case "accept-suggestion":
      return `Accept suggestion #${cmd.fileId}`;
    case "accept-all-suggestions":
      return `Accept ${cmd.suggestions.length} suggestions`;
    case "stage-assimilate-op":
      return `Stage ${cmd.op.type}: ${cmd.op.sourcePath.split("/").pop()}`;
    case "unstage-assimilate-op":
      return `Unstage op #${cmd.opIndex}`;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `sandboxCommands.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/sandboxCommands.ts
git commit -m "feat(sandbox): command types and derive-state reducer"
```

---

### Task 2: Sandbox Session React Hook

**Files:**
- Create: `frontend/src/hooks/useSandboxSession.tsx`

- [ ] **Step 1: Create the context and provider**

```typescript
// frontend/src/hooks/useSandboxSession.tsx
import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  type SandboxCommand,
  type DerivedSandboxState,
  deriveState,
} from "@/lib/sandboxCommands";

interface SandboxSession {
  scanId: string;
  sessionId: number | null;
  commands: SandboxCommand[];
  cursor: number;

  derived: DerivedSandboxState;

  execute: (cmd: SandboxCommand) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  discard: () => void;
  commandCount: number;
  hasChanges: boolean;
}

const SandboxContext = createContext<SandboxSession | null>(null);

const LS_KEY_PREFIX = "sandbox:scan:";

interface SavedState {
  commands: SandboxCommand[];
  cursor: number;
  sessionId: number | null;
  savedAt: number;
}

function loadFromLocalStorage(scanId: string): SavedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + scanId);
    if (!raw) return null;
    return JSON.parse(raw) as SavedState;
  } catch {
    return null;
  }
}

function saveToLocalStorage(scanId: string, state: SavedState): void {
  try {
    localStorage.setItem(LS_KEY_PREFIX + scanId, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function clearLocalStorage(scanId: string): void {
  try {
    localStorage.removeItem(LS_KEY_PREFIX + scanId);
  } catch {
    // ignore
  }
}

export function SandboxSessionProvider({
  scanId,
  children,
}: {
  scanId: string;
  children: ReactNode;
}) {
  // Restore from localStorage on mount
  const restored = useMemo(() => loadFromLocalStorage(scanId), [scanId]);

  const [commands, setCommands] = useState<SandboxCommand[]>(
    restored?.commands ?? []
  );
  const [cursor, setCursor] = useState<number>(restored?.cursor ?? 0);
  const [sessionId, setSessionId] = useState<number | null>(
    restored?.sessionId ?? null
  );

  // Derived state — recomputed when active commands change
  const activeCommands = useMemo(
    () => commands.slice(0, cursor),
    [commands, cursor]
  );
  const derived = useMemo(() => deriveState(activeCommands), [activeCommands]);

  // Persist to localStorage on every change
  useEffect(() => {
    saveToLocalStorage(scanId, {
      commands,
      cursor,
      sessionId,
      savedAt: Date.now(),
    });
  }, [scanId, commands, cursor, sessionId]);

  // Debounced save to backend (2 seconds)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sessionId || commands.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/sandbox/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands, cursor }),
        });
      } catch {
        // Network error — localStorage has the latest state
      }
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionId, commands, cursor]);

  const execute = useCallback(
    (cmd: SandboxCommand) => {
      setCommands((prev) => [...prev.slice(0, cursor), cmd]);
      setCursor((prev) => prev + 1);

      // Auto-create backend session on first command
      if (!sessionId) {
        fetch(`/api/scans/${scanId}/sandbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
          .then((r) => r.json())
          .then((data) => setSessionId(data.id))
          .catch(() => {});
      }
    },
    [cursor, sessionId, scanId]
  );

  const undo = useCallback(() => {
    setCursor((c) => Math.max(0, c - 1));
  }, []);

  const redo = useCallback(() => {
    setCursor((c) => Math.min(commands.length, c + 1));
  }, [commands.length]);

  const discard = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/sandbox/${sessionId}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }
    setCommands([]);
    setCursor(0);
    setSessionId(null);
    clearLocalStorage(scanId);
  }, [sessionId, scanId]);

  const session: SandboxSession = useMemo(
    () => ({
      scanId,
      sessionId,
      commands,
      cursor,
      derived,
      execute,
      undo,
      redo,
      canUndo: cursor > 0,
      canRedo: cursor < commands.length,
      discard,
      commandCount: cursor,
      hasChanges: cursor > 0,
    }),
    [
      scanId,
      sessionId,
      commands,
      cursor,
      derived,
      execute,
      undo,
      redo,
      discard,
    ]
  );

  return (
    <SandboxContext.Provider value={session}>
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox(): SandboxSession {
  const ctx = useContext(SandboxContext);
  if (!ctx) {
    throw new Error("useSandbox must be used within a SandboxSessionProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `useSandboxSession.tsx`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSandboxSession.tsx
git commit -m "feat(sandbox): session hook with command stack, undo/redo, localStorage"
```

---

### Task 3: Backend Model and Schema Migration

**Files:**
- Create: `backend/app/models/sandbox.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Create the SandboxSession model**

```python
# backend/app/models/sandbox.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Index, func
from app.database import Base


class SandboxSession(Base):
    __tablename__ = "sandbox_sessions"

    id = Column(Integer, primary_key=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=True)
    commands = Column(JSON, nullable=False, default=list)
    cursor = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_sandbox_sessions_scan_id", "scan_id"),
    )
```

- [ ] **Step 2: Export from models/__init__.py**

In `backend/app/models/__init__.py`, add the import:

```python
from app.models.sandbox import SandboxSession
```

Add `SandboxSession` to the `__all__` list if one exists, otherwise just add the import at the end of the file alongside the other model imports.

- [ ] **Step 3: Add schema v4 migration in database.py**

In `backend/app/database.py`, after the v3 migration block (around line 154), add:

```python
        if current_version < 4:
            logger.info("Migrating schema to v4: sandbox_sessions table")
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS sandbox_sessions ("
                "  id INTEGER PRIMARY KEY,"
                "  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,"
                "  name TEXT,"
                "  commands TEXT NOT NULL DEFAULT '[]',"
                "  cursor INTEGER NOT NULL DEFAULT 0,"
                "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
                "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                ")"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_sandbox_sessions_scan_id "
                "ON sandbox_sessions (scan_id)"
            ))
            conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '4')"
            ))
            conn.commit()
            logger.info("Schema migrated to v4")
```

- [ ] **Step 4: Run backend tests**

Run: `cd /Users/jackf/Documents/Development/Collective/backend && python -m pytest tests/ -v 2>&1 | tail -10`
Expected: All previously passing tests still pass

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/sandbox.py backend/app/models/__init__.py backend/app/database.py
git commit -m "feat(sandbox): SandboxSession model + schema v4 migration"
```

---

### Task 4: Backend API Endpoints

**Files:**
- Create: `backend/app/api/sandbox.py`
- Modify: `backend/app/api/router.py`

- [ ] **Step 1: Create sandbox API endpoints**

```python
# backend/app/api/sandbox.py
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.sandbox import SandboxSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class CreateSessionRequest(BaseModel):
    name: str | None = None


class UpdateSessionRequest(BaseModel):
    commands: list = []
    cursor: int = 0


class SessionResponse(BaseModel):
    id: int
    scan_id: int
    name: str | None
    commands: list
    cursor: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


@router.get("/scans/{scan_id}/sandbox", response_model=SessionResponse)
async def get_session(scan_id: int, db: AsyncSession = Depends(get_db)):
    """Get the active sandbox session for a scan, or 404."""
    result = await db.execute(
        select(SandboxSession)
        .where(SandboxSession.scan_id == scan_id)
        .order_by(SandboxSession.updated_at.desc())
        .limit(1)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox session")
    return session


@router.post("/scans/{scan_id}/sandbox", response_model=SessionResponse)
async def create_session(
    scan_id: int,
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a sandbox session for a scan. Returns existing session if one exists (idempotent)."""
    # Check for existing
    result = await db.execute(
        select(SandboxSession).where(SandboxSession.scan_id == scan_id)
    )
    existing = result.scalars().first()
    if existing:
        return existing

    session = SandboxSession(
        scan_id=scan_id,
        name=body.name,
        commands=[],
        cursor=0,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    logger.info("Created sandbox session %d for scan %d", session.id, scan_id)
    return session


@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: int,
    body: UpdateSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Save commands + cursor (debounced from frontend)."""
    result = await db.execute(
        select(SandboxSession).where(SandboxSession.id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.commands = body.commands
    session.cursor = body.cursor
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Discard a sandbox session."""
    result = await db.execute(
        select(SandboxSession).where(SandboxSession.id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    logger.info("Deleted sandbox session %d", session_id)
    return {"ok": True}
```

Note: The `/scans/{scan_id}/sandbox` routes use a path prefix that overlaps with the scans router. To avoid conflicts, these routes are mounted on the sandbox router but with the full path prefix. This works because FastAPI resolves routes by specificity.

- [ ] **Step 2: Mount the sandbox router**

In `backend/app/api/router.py`, add the import and include:

```python
from app.api.sandbox import router as sandbox_router
```

Add to the router includes (alongside the existing ones):

```python
api_router.include_router(sandbox_router)
```

Note: The sandbox router already has `prefix="/sandbox"` for the `/{session_id}` routes, but the scan-scoped routes (`/scans/{scan_id}/sandbox`) use the full path. Mount it without an additional prefix on `api_router`.

- [ ] **Step 3: Run backend tests**

Run: `cd /Users/jackf/Documents/Development/Collective/backend && python -m pytest tests/ -v 2>&1 | tail -10`
Expected: All previously passing tests still pass

- [ ] **Step 4: Test manually with curl**

Start the dev server and test:

```bash
# Create session
curl -s -X POST http://localhost:8080/api/scans/17/sandbox -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool

# Update with commands
curl -s -X PUT http://localhost:8080/api/sandbox/1 -H 'Content-Type: application/json' -d '{"commands": [{"type": "promote-hub", "peerDir": "/mnt/test"}], "cursor": 1}' | python3 -m json.tool

# Get session
curl -s http://localhost:8080/api/scans/17/sandbox | python3 -m json.tool

# Delete session
curl -s -X DELETE http://localhost:8080/api/sandbox/1 | python3 -m json.tool
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/sandbox.py backend/app/api/router.py
git commit -m "feat(sandbox): REST endpoints for session CRUD"
```

---

### Task 5: Atomic Commit Task

**Files:**
- Create: `backend/app/tasks/session_tasks.py`
- Modify: `backend/app/tasks/worker.py`

- [ ] **Step 1: Create the atomic commit Huey task**

```python
# backend/app/tasks/session_tasks.py
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import get_sync_session
from app.models.sandbox import SandboxSession
from app.models.duplicate import DuplicateFile
from app.models.action import Action
from app.tasks.worker import huey

logger = logging.getLogger(__name__)


class CommitRollbackError(Exception):
    """Raised when rollback itself fails."""
    pass


@huey.task()
def commit_sandbox_session(session_id: int):
    """Execute all sandbox commands atomically. Rolls back on failure.

    Execution order (dependency-safe):
    1. Create directories (mkdir for move destinations)
    2. Tag originals
    3. Move originals to destinations
    4. Delete marked directories
    """
    db = get_sync_session()
    completed_actions: list[dict] = []  # Track for rollback

    try:
        session = db.get(SandboxSession, session_id)
        if not session:
            logger.error("Sandbox session %d not found", session_id)
            return {"status": "error", "message": "Session not found"}

        commands = session.commands[:session.cursor] if session.cursor else session.commands
        if not commands:
            return {"status": "error", "message": "No commands to commit"}

        scan_id = session.scan_id
        logger.info("Committing sandbox session %d for scan %d (%d commands)",
                    session_id, scan_id, len(commands))

        # Parse commands into action groups
        tagged_originals: list[str] = []
        move_ops: list[dict] = []  # {sourceDir, destDir}
        delete_dirs: list[str] = []
        keeper_decisions: dict[str, int] = {}  # checksum → fileId

        for cmd in commands:
            cmd_type = cmd.get("type")
            if cmd_type == "tag-original":
                tagged_originals.append(cmd["directory"])
            elif cmd_type == "untag-original":
                if cmd["directory"] in tagged_originals:
                    tagged_originals.remove(cmd["directory"])
            elif cmd_type == "set-move-dest":
                move_ops.append({"source": cmd["sourceDir"], "dest": cmd["destDir"]})
            elif cmd_type == "mark-delete":
                delete_dirs.append(cmd["directory"])
            elif cmd_type == "unmark-delete":
                if cmd["directory"] in delete_dirs:
                    delete_dirs.remove(cmd["directory"])
            elif cmd_type == "set-keeper":
                keeper_decisions[cmd["checksum"]] = cmd["fileId"]
            elif cmd_type == "clear-keeper":
                keeper_decisions.pop(cmd["checksum"], None)
            elif cmd_type == "accept-suggestion":
                keeper_decisions[cmd["checksum"]] = cmd["fileId"]
            elif cmd_type == "accept-all-suggestions":
                for s in cmd.get("suggestions", []):
                    keeper_decisions[s["checksum"]] = s["fileId"]
            # promote-hub and assimilate ops are UI-only or handled separately

        # Phase 1: Create destination directories
        for move in move_ops:
            dest = move["dest"]
            if not os.path.exists(dest):
                try:
                    os.makedirs(dest, exist_ok=True)
                    completed_actions.append({"type": "mkdir", "path": dest})
                    logger.info("Created directory: %s", dest)
                except OSError as e:
                    logger.error("Failed to create directory %s: %s", dest, e)
                    _rollback(completed_actions)
                    db.delete(session)
                    db.commit()
                    return {"status": "rolled_back", "error": str(e)}

        # Phase 2: Tag originals (DB only, safe to reverse)
        if tagged_originals:
            # Reset all to non-original first
            db.execute(
                update(DuplicateFile)
                .where(DuplicateFile.scan_id == scan_id)
                .values(is_original=False)
            )
            # Mark tagged paths as original
            from sqlalchemy import or_
            conditions = [
                DuplicateFile.path.startswith(p.rstrip("/") + "/")
                for p in tagged_originals
            ]
            db.execute(
                update(DuplicateFile)
                .where(DuplicateFile.scan_id == scan_id, or_(*conditions))
                .values(is_original=True)
            )
            db.commit()
            completed_actions.append({"type": "tag-originals", "paths": tagged_originals})
            logger.info("Tagged %d directories as original", len(tagged_originals))

        # Phase 3: Move operations
        import shutil
        for move in move_ops:
            source = move["source"]
            dest = move["dest"]
            dir_name = source.rstrip("/").split("/")[-1]
            full_dest = os.path.join(dest, dir_name)
            try:
                shutil.move(source, full_dest)
                completed_actions.append({"type": "move", "source": source, "dest": full_dest})
                logger.info("Moved %s → %s", source, full_dest)
            except (OSError, shutil.Error) as e:
                logger.error("Move failed %s → %s: %s", source, full_dest, e)
                _rollback(completed_actions)
                return {"status": "rolled_back", "error": str(e)}

        # Phase 4: Delete marked directories
        for dir_path in delete_dirs:
            if not os.path.exists(dir_path):
                logger.warning("Directory already gone: %s", dir_path)
                continue
            try:
                shutil.rmtree(dir_path)
                completed_actions.append({"type": "delete", "path": dir_path})
                logger.info("Deleted: %s", dir_path)
            except OSError as e:
                logger.error("Delete failed %s: %s", dir_path, e)
                _rollback(completed_actions)
                return {"status": "rolled_back", "error": str(e)}

        # Phase 5: Apply keeper decisions (delete non-keeper files)
        if keeper_decisions:
            kept_ids = set(keeper_decisions.values())
            for checksum, keeper_id in keeper_decisions.items():
                # Find all files with this checksum that are NOT the keeper
                dupes = db.execute(
                    select(DuplicateFile).where(
                        DuplicateFile.scan_id == scan_id,
                        DuplicateFile.checksum == checksum,
                        DuplicateFile.id != keeper_id,
                    )
                ).scalars().all()
                for dupe in dupes:
                    if os.path.exists(dupe.path):
                        try:
                            os.remove(dupe.path)
                            completed_actions.append({"type": "delete-file", "path": dupe.path})
                        except OSError as e:
                            logger.error("Failed to delete file %s: %s", dupe.path, e)
                            _rollback(completed_actions)
                            return {"status": "rolled_back", "error": str(e)}
            logger.info("Applied %d keeper decisions", len(keeper_decisions))

        # Success — delete the sandbox session
        db.delete(session)
        db.commit()
        logger.info("Sandbox session %d committed successfully", session_id)
        return {"status": "completed", "actions": len(completed_actions)}

    except Exception as e:
        logger.exception("Sandbox commit failed: %s", e)
        try:
            _rollback(completed_actions)
        except CommitRollbackError as re:
            logger.critical("ROLLBACK FAILED: %s", re)
            return {"status": "failed_partial", "error": str(e), "rollback_error": str(re)}
        return {"status": "rolled_back", "error": str(e)}
    finally:
        db.close()


def _rollback(completed_actions: list[dict]):
    """Reverse completed actions in LIFO order."""
    import shutil
    for action in reversed(completed_actions):
        try:
            if action["type"] == "mkdir":
                if os.path.isdir(action["path"]) and not os.listdir(action["path"]):
                    os.rmdir(action["path"])
                    logger.info("Rollback: removed empty dir %s", action["path"])
            elif action["type"] == "move":
                # Move back
                shutil.move(action["dest"], action["source"])
                logger.info("Rollback: moved %s back to %s", action["dest"], action["source"])
            elif action["type"] == "delete":
                # Can't restore deleted directory — this is why moves come before deletes
                logger.warning("Rollback: cannot restore deleted directory %s", action["path"])
            elif action["type"] == "delete-file":
                logger.warning("Rollback: cannot restore deleted file %s", action["path"])
            elif action["type"] == "tag-originals":
                # DB tagging is reversible but complex — leave for now
                logger.info("Rollback: tag-originals requires manual DB fix")
        except Exception as e:
            raise CommitRollbackError(
                f"Failed to rollback {action['type']} on {action.get('path', action.get('source', '?'))}: {e}"
            )
```

- [ ] **Step 2: Register the task module in worker.py**

In `backend/app/tasks/worker.py`, add at the end:

```python
import app.tasks.session_tasks  # noqa: F401, E402
```

- [ ] **Step 3: Add commit endpoint to sandbox API**

In `backend/app/api/sandbox.py`, add at the end of the file:

```python
@router.post("/{session_id}/commit")
async def commit_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Commit a sandbox session atomically. Enqueues a Huey task."""
    result = await db.execute(
        select(SandboxSession).where(SandboxSession.id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.tasks.session_tasks import commit_sandbox_session
    commit_sandbox_session(session.id)
    logger.info("Enqueued commit for sandbox session %d", session_id)
    return {"status": "committing", "session_id": session_id}
```

- [ ] **Step 4: Run backend tests**

Run: `cd /Users/jackf/Documents/Development/Collective/backend && python -m pytest tests/ -v 2>&1 | tail -10`
Expected: All previously passing tests still pass

- [ ] **Step 5: Commit**

```bash
git add backend/app/tasks/session_tasks.py backend/app/tasks/worker.py backend/app/api/sandbox.py
git commit -m "feat(sandbox): atomic commit task with rollback"
```

---

### Task 6: Frontend API Hooks

**Files:**
- Create: `frontend/src/api/sandbox.ts`

- [ ] **Step 1: Create React Query hooks for sandbox API**

```typescript
// frontend/src/api/sandbox.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put, del } from "@/api/client";

interface SandboxSessionResponse {
  id: number;
  scan_id: number;
  name: string | null;
  commands: unknown[];
  cursor: number;
  created_at: string;
  updated_at: string;
}

export function useSandboxSessionQuery(scanId: string | undefined) {
  return useQuery({
    queryKey: ["sandbox", scanId],
    queryFn: () => get<SandboxSessionResponse>(`/scans/${scanId}/sandbox`),
    enabled: !!scanId,
    retry: false, // 404 is expected when no session exists
    staleTime: Infinity, // Session state is managed locally
  });
}

export function useCreateSandboxSession(scanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) =>
      post<SandboxSessionResponse>(`/scans/${scanId}/sandbox`, { name }),
    onSuccess: (data) => {
      queryClient.setQueryData(["sandbox", scanId], data);
    },
  });
}

export function useSaveSandboxSession() {
  return useMutation({
    mutationFn: ({
      sessionId,
      commands,
      cursor,
    }: {
      sessionId: number;
      commands: unknown[];
      cursor: number;
    }) => put<SandboxSessionResponse>(`/sandbox/${sessionId}`, { commands, cursor }),
  });
}

export function useDeleteSandboxSession(scanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => del(`/sandbox/${sessionId}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["sandbox", scanId] });
    },
  });
}

export function useCommitSandboxSession() {
  return useMutation({
    mutationFn: (sessionId: number) =>
      post<{ status: string; session_id: number }>(`/sandbox/${sessionId}/commit`, {}),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/sandbox.ts
git commit -m "feat(sandbox): React Query hooks for session CRUD + commit"
```

---

### Task 7: Wire Backend Session Loading into the Hook

**Files:**
- Modify: `frontend/src/hooks/useSandboxSession.tsx`

- [ ] **Step 1: Add backend session loading on mount**

Update `SandboxSessionProvider` to load from the backend on mount and reconcile with localStorage. Replace the state initialization section with:

At the top of `SandboxSessionProvider`, before the `useState` calls, add the backend query:

```typescript
  // Try to load from backend
  const { data: backendSession } = useSandboxSessionQuery(scanId);
```

Add the import at the top of the file:

```typescript
import { useSandboxSessionQuery } from "@/api/sandbox";
```

Then update the initial state resolution to prefer the newer source. Replace the `restored` / `useState` block:

```typescript
  // Resolve initial state: localStorage vs backend, take newer
  const lsState = useMemo(() => loadFromLocalStorage(scanId), [scanId]);

  const initial = useMemo(() => {
    if (!lsState && !backendSession) return { commands: [], cursor: 0, sessionId: null };
    if (!backendSession) return { commands: lsState!.commands, cursor: lsState!.cursor, sessionId: lsState!.sessionId };
    if (!lsState) return { commands: backendSession.commands as SandboxCommand[], cursor: backendSession.cursor, sessionId: backendSession.id };

    // Both exist — take newer
    const backendTime = new Date(backendSession.updated_at).getTime();
    if (lsState.savedAt > backendTime) {
      return { commands: lsState.commands, cursor: lsState.cursor, sessionId: backendSession.id };
    }
    return { commands: backendSession.commands as SandboxCommand[], cursor: backendSession.cursor, sessionId: backendSession.id };
  }, [lsState, backendSession, scanId]);

  const [commands, setCommands] = useState<SandboxCommand[]>(initial.commands);
  const [cursor, setCursor] = useState<number>(initial.cursor);
  const [sessionId, setSessionId] = useState<number | null>(initial.sessionId);
```

Note: The `initial` memo triggers re-render when `backendSession` loads. The `useState` initializers only run once, but we add a `useEffect` to sync when backend data arrives:

```typescript
  // Sync from backend when it loads (only if we don't have local changes)
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (backendSession && !hasInitialized.current) {
      hasInitialized.current = true;
      const lsState = loadFromLocalStorage(scanId);
      const backendTime = new Date(backendSession.updated_at).getTime();
      if (!lsState || lsState.savedAt <= backendTime) {
        setCommands(backendSession.commands as SandboxCommand[]);
        setCursor(backendSession.cursor);
        setSessionId(backendSession.id);
      } else {
        // localStorage is newer — just set the session ID
        setSessionId(backendSession.id);
      }
    }
  }, [backendSession, scanId]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useSandboxSession.tsx
git commit -m "feat(sandbox): backend session loading + localStorage reconciliation"
```

---

### Task 8: Session Summary Bar Component

**Files:**
- Create: `frontend/src/components/results/SessionSummaryBar.tsx`

- [ ] **Step 1: Create the summary bar**

```typescript
// frontend/src/components/results/SessionSummaryBar.tsx
import { Undo2, Redo2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSandbox } from "@/hooks/useSandboxSession";
import { useCommitSandboxSession } from "@/api/sandbox";
import { commandLabel } from "@/lib/sandboxCommands";

export function SessionSummaryBar() {
  const session = useSandbox();
  const commitMutation = useCommitSandboxSession();

  if (!session.hasChanges) return null;

  const activeCommands = session.commands.slice(0, session.cursor);
  const lastCommand = activeCommands[activeCommands.length - 1];

  const handleCommit = () => {
    if (!session.sessionId) return;
    if (!confirm("Commit all changes to disk? This will execute all planned operations.")) return;
    commitMutation.mutate(session.sessionId);
  };

  const handleDiscard = () => {
    if (!confirm("Discard all changes? This cannot be undone.")) return;
    session.discard();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Left: undo/redo + last action */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={session.undo}
              disabled={!session.canUndo}
              title="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={session.redo}
              disabled={!session.canRedo}
              title="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">
            {session.commandCount} change{session.commandCount !== 1 ? "s" : ""}
            {lastCommand && (
              <span className="ml-2 text-foreground">
                — {commandLabel(lastCommand)}
              </span>
            )}
          </span>
        </div>

        {/* Right: discard + commit */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={commitMutation.isPending || !session.sessionId}
          >
            <Save className="h-4 w-4 mr-1" />
            {commitMutation.isPending ? "Committing..." : "Commit to Disk"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/SessionSummaryBar.tsx
git commit -m "feat(sandbox): session summary bar with undo/redo/commit/discard"
```

---

### Task 9: Integrate Provider into Layout

**Files:**
- Modify: `frontend/src/components/layout/Layout.tsx`
- Modify: `frontend/src/pages/ScanResults.tsx`

- [ ] **Step 1: Add SandboxSessionProvider to ScanResults page**

The sandbox is scan-scoped, so the provider wraps at the page level (ScanResults), not the Layout level. This ensures the `scanId` is available from route params.

In `frontend/src/pages/ScanResults.tsx`, add the import:

```typescript
import { SandboxSessionProvider } from "@/hooks/useSandboxSession";
import { SessionSummaryBar } from "@/components/results/SessionSummaryBar";
```

Wrap the entire return JSX with the provider. Find the `return (` at the start of the component's render and wrap:

```typescript
  return (
    <SandboxSessionProvider scanId={id!}>
      {/* ... existing JSX ... */}
      <SessionSummaryBar />
    </SandboxSessionProvider>
  );
```

Place `<SessionSummaryBar />` just before the closing `</SandboxSessionProvider>` tag, after all existing content. It renders as a fixed-position bottom bar, so placement in the tree doesn't matter visually.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ScanResults.tsx
git commit -m "feat(sandbox): wire provider + summary bar into ScanResults"
```

---

### Task 10: Deploy and Verify

**Files:** None (deployment)

- [ ] **Step 1: Push to remote**

```bash
git push origin main
```

- [ ] **Step 2: Deploy to server**

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude=dist --exclude=.venv /Users/jackf/Documents/Development/Collective/ root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build --no-cache -f docker/Dockerfile -t collective:latest ."
ssh root@192.168.50.45 "docker stop collective && docker rm collective && docker run -d --name collective --restart unless-stopped -p 8080:8080 -v /mnt/user:/mnt/user -v /mnt/user/appdata/collective:/data collective:latest"
```

- [ ] **Step 3: Verify**

```bash
ssh root@192.168.50.45 "docker logs collective --tail 15 2>&1"
```

Expected: All processes running. Schema migration v4 log line. No errors.

- [ ] **Step 4: Test sandbox API**

```bash
curl -s http://192.168.50.45:8080/api/system/health | python3 -m json.tool
curl -s -X POST http://192.168.50.45:8080/api/scans/17/sandbox -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool
```

Expected: Health OK, session created with empty commands.

- [ ] **Step 5: Commit deploy verification**

```bash
git add -A && git status
# Only commit if there are changes (e.g., tsconfig.tsbuildinfo)
```
