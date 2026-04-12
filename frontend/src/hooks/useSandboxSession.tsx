import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deriveState,
  type DerivedSandboxState,
  type SandboxCommand,
} from "@/lib/sandboxCommands";
import { useSandboxSessionQuery } from "@/api/sandbox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxSession {
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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SandboxContext = createContext<SandboxSession | null>(null);

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

interface PersistedState {
  commands: SandboxCommand[];
  cursor: number;
  sessionId: number | null;
  savedAt: number;
}

function storageKey(scanId: string): string {
  return `sandbox:scan:${scanId}`;
}

function loadPersistedState(scanId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(scanId));
    if (raw == null) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function savePersistedState(scanId: string, state: PersistedState): void {
  try {
    localStorage.setItem(storageKey(scanId), JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function clearPersistedState(scanId: string): void {
  try {
    localStorage.removeItem(storageKey(scanId));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SandboxSessionProvider({
  scanId,
  children,
}: {
  scanId: string;
  children: ReactNode;
}) {
  // Initialise from localStorage if available
  const [commands, setCommands] = useState<SandboxCommand[]>(() => {
    const persisted = loadPersistedState(scanId);
    return persisted?.commands ?? [];
  });

  const [cursor, setCursor] = useState<number>(() => {
    const persisted = loadPersistedState(scanId);
    return persisted?.cursor ?? 0;
  });

  const [sessionId, setSessionId] = useState<number | null>(() => {
    const persisted = loadPersistedState(scanId);
    return persisted?.sessionId ?? null;
  });

  const { data: backendSession } = useSandboxSessionQuery(scanId);

  // Sync backend session with localStorage on first load — take the newer source
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (backendSession && !hasInitialized.current) {
      hasInitialized.current = true;
      const lsState = loadPersistedState(scanId);
      const backendTime = new Date(backendSession.updated_at).getTime();
      if (!lsState || lsState.savedAt <= backendTime) {
        setCommands(backendSession.commands as SandboxCommand[]);
        setCursor(backendSession.cursor);
        setSessionId(backendSession.id);
      } else {
        // localStorage is newer — just sync the session ID
        setSessionId(backendSession.id);
      }
    }
  }, [backendSession, scanId]);

  // Ref to track whether we're currently creating a session (avoid duplicates)
  const creatingSession = useRef(false);

  // Keep a ref of cursor so execute() can read it without a stale closure
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Debounce timer ref for backend save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const activeCommands = useMemo(
    () => commands.slice(0, cursor),
    [commands, cursor],
  );

  const derived = useMemo(() => deriveState(activeCommands), [activeCommands]);

  // ---------------------------------------------------------------------------
  // Persist to localStorage on every change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    savePersistedState(scanId, {
      commands,
      cursor,
      sessionId,
      savedAt: Date.now(),
    });
  }, [scanId, commands, cursor, sessionId]);

  // ---------------------------------------------------------------------------
  // Debounced backend save (2s) — only when sessionId exists
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (sessionId == null) return;

    if (saveTimerRef.current != null) {
      clearTimeout(saveTimerRef.current);
    }

    const currentSessionId = sessionId;
    const payload = { commands, cursor };

    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/sandbox/${currentSessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // fire-and-forget — backend save failures are non-critical
      });
    }, 2000);

    return () => {
      if (saveTimerRef.current != null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [sessionId, commands, cursor]);

  // ---------------------------------------------------------------------------
  // Session creation helper
  // ---------------------------------------------------------------------------

  const ensureSession = useCallback(async () => {
    if (sessionId != null || creatingSession.current) return;
    creatingSession.current = true;

    try {
      const res = await fetch(`/api/scans/${scanId}/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as { id: number };
        setSessionId(data.id);
      }
    } catch {
      // session creation failed — we'll retry on next execute
    } finally {
      creatingSession.current = false;
    }
  }, [scanId, sessionId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const execute = useCallback(
    (cmd: SandboxCommand) => {
      setCommands((prev) => {
        // Slice at cursor to discard any undone future commands, then append
        const active = prev.slice(0, cursorRef.current);
        return [...active, cmd];
      });
      setCursor(() => cursorRef.current + 1);
      void ensureSession();
    },
    [ensureSession],
  );

  const undo = useCallback(() => {
    setCursor((prev) => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setCursor((prev) => Math.min(commands.length, prev + 1));
  }, [commands.length]);

  const discard = useCallback(() => {
    if (sessionId != null) {
      fetch(`/api/sandbox/${sessionId}`, { method: "DELETE" }).catch(() => {
        // fire-and-forget
      });
    }
    setCommands([]);
    setCursor(0);
    setSessionId(null);
    clearPersistedState(scanId);
  }, [scanId, sessionId]);

  // ---------------------------------------------------------------------------
  // Cleanup debounce timer on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Memoised session value
  // ---------------------------------------------------------------------------

  const session = useMemo<SandboxSession>(
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
    [scanId, sessionId, commands, cursor, derived, execute, undo, redo, discard],
  );

  return (
    <SandboxContext.Provider value={session}>
      {children}
    </SandboxContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useSandbox(): SandboxSession {
  const ctx = useContext(SandboxContext);
  if (ctx == null) {
    throw new Error("useSandbox must be used within a <SandboxSessionProvider>");
  }
  return ctx;
}
