# Sandbox Session — Plan C: The Map Visualization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "The Map" — a real-time React Flow node-graph visualization showing the aggregate effect of all sandbox commands: source directories being removed on the left, new archive structure forming on the right, with animated flow edges connecting them.

**Architecture:** React Flow canvas with custom node components (DirectoryNode, DestinationNode) and animated edges. Dagre handles auto-layout (left-to-right). Nodes and edges are derived from the sandbox `derived` state via a `useMapGraph` hook. The Map is a new tab in ScanResults alongside Overview, Duplicate Files, and Similar Directories. The commit progress overlay transforms the map into a live execution monitor.

**Tech Stack:** @xyflow/react (React Flow v12), dagre (graph layout), framer-motion (node enter/exit), existing Tailwind dark theme

**Depends on:** Plan A (sandbox infrastructure) + Plan B (component rewiring) — both complete

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/package.json` | Modify | Add `@xyflow/react`, `dagre`, `@types/dagre` |
| `frontend/src/hooks/useMapGraph.ts` | Create | Derive React Flow nodes + edges from sandbox state |
| `frontend/src/components/results/SessionMap.tsx` | Create | React Flow canvas with controls, minimap, dark theme |
| `frontend/src/components/results/SessionMapNodes.tsx` | Create | Custom node components: DirectoryNode, DestinationNode |
| `frontend/src/components/results/CommitProgressOverlay.tsx` | Create | Overlay during commit: phase progress, per-node status |
| `frontend/src/pages/ScanResults.tsx` | Modify | Add "Session Map" tab |
| `frontend/src/components/results/SessionSummaryBar.tsx` | Modify | Add map toggle shortcut |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install React Flow and dagre**

```bash
cd /Users/jackf/Documents/Development/Collective/frontend
npm install @xyflow/react dagre
npm install -D @types/dagre
```

- [ ] **Step 2: Verify install**

```bash
cd /Users/jackf/Documents/Development/Collective/frontend && node -e "require('@xyflow/react'); require('dagre'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "deps: add @xyflow/react and dagre for session map"
```

---

### Task 2: useMapGraph Hook — Derive Nodes and Edges from Sandbox

**Files:**
- Create: `frontend/src/hooks/useMapGraph.ts`

- [ ] **Step 1: Create the hook**

This hook takes the sandbox `derived` state and produces React Flow nodes and edges with Dagre auto-layout.

```typescript
// frontend/src/hooks/useMapGraph.ts
import { useMemo } from "react";
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";
import type { DerivedSandboxState } from "@/lib/sandboxCommands";

export interface MapNodeData {
  label: string;
  fullPath: string;
  type: "source" | "destination" | "delete" | "keeper";
  reason?: string;
  size?: string;
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 72;

function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export function useMapGraph(derived: DerivedSandboxState): {
  nodes: Node[];
  edges: Edge[];
} {
  return useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Source nodes — directories marked for deletion
    for (const [dir, reason] of derived.markedForDelete) {
      const dirName = dir.split("/").pop() || dir;
      nodes.push({
        id: `del:${dir}`,
        type: "directoryNode",
        position: { x: 0, y: 0 },
        data: {
          label: dirName,
          fullPath: dir,
          type: "delete",
          reason,
        } satisfies MapNodeData,
      });
    }

    // Source nodes — directories tagged as original (being moved)
    for (const dir of derived.taggedOriginals) {
      const dirName = dir.split("/").pop() || dir;
      const isMoving = derived.moveDestinations.has(dir);
      // Only add if not already added as a delete node
      if (!derived.markedForDelete.has(dir)) {
        nodes.push({
          id: `src:${dir}`,
          type: "directoryNode",
          position: { x: 0, y: 0 },
          data: {
            label: dirName,
            fullPath: dir,
            type: isMoving ? "source" : "keeper",
            reason: isMoving ? "Moving to archive" : "Tagged as original",
          } satisfies MapNodeData,
        });
      }
    }

    // Destination nodes — move targets
    for (const [sourceDir, destDir] of derived.moveDestinations) {
      const destName = destDir.split("/").pop() || destDir;
      const destNodeId = `dest:${destDir}`;

      // Add destination node if not already present
      if (!nodes.find((n) => n.id === destNodeId)) {
        nodes.push({
          id: destNodeId,
          type: "directoryNode",
          position: { x: 0, y: 0 },
          data: {
            label: destName,
            fullPath: destDir,
            type: "destination",
          } satisfies MapNodeData,
        });
      }

      // Edge: source → destination
      const sourceNodeId = derived.markedForDelete.has(sourceDir)
        ? `del:${sourceDir}`
        : `src:${sourceDir}`;
      edges.push({
        id: `edge:${sourceDir}->${destDir}`,
        source: sourceNodeId,
        target: destNodeId,
        animated: true,
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      });
    }

    // Edges: deleted dirs → their reason (connect to the source they duplicate)
    // Only if the "reason" references a directory that's also a node
    for (const [dir, reason] of derived.markedForDelete) {
      const match = reason.match(/Duplicate of (.+)/);
      if (match) {
        const originalDir = match[1];
        const originalNodeId = nodes.find(
          (n) => n.data.fullPath === originalDir
        )?.id;
        if (originalNodeId) {
          edges.push({
            id: `edge:dup:${dir}`,
            source: `del:${dir}`,
            target: originalNodeId,
            animated: false,
            style: {
              stroke: "hsl(var(--destructive))",
              strokeWidth: 1,
              strokeDasharray: "5 5",
            },
          });
        }
      }
    }

    // Apply Dagre layout
    if (nodes.length === 0) return { nodes: [], edges: [] };
    const layoutNodes = layoutGraph(nodes, edges);

    return { nodes: layoutNodes, edges };
  }, [derived]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useMapGraph.ts
git commit -m "feat(map): useMapGraph hook — derive nodes+edges from sandbox state"
```

---

### Task 3: Custom Node Components

**Files:**
- Create: `frontend/src/components/results/SessionMapNodes.tsx`

- [ ] **Step 1: Create custom node components**

```typescript
// frontend/src/components/results/SessionMapNodes.tsx
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Folder, FolderOutput, Trash2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapNodeData } from "@/hooks/useMapGraph";

const iconMap = {
  source: FolderOutput,
  destination: FolderOutput,
  delete: Trash2,
  keeper: Shield,
};

const glowMap = {
  source: "shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)] border-primary/40",
  destination: "shadow-[0_0_15px_rgba(59,130,246,0.2)] border-blue-400/40",
  delete: "shadow-[0_0_15px_rgba(239,68,68,0.2)] border-destructive/40",
  keeper: "shadow-[0_0_15px_rgba(34,197,94,0.2)] border-success/40",
};

const bgMap = {
  source: "bg-primary/5",
  destination: "bg-blue-500/5",
  delete: "bg-destructive/5",
  keeper: "bg-success/5",
};

const iconColorMap = {
  source: "text-primary",
  destination: "text-blue-400",
  delete: "text-destructive",
  keeper: "text-success",
};

function DirectoryNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as MapNodeData;
  const Icon = iconMap[nodeData.type] || Folder;

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={cn(
          "rounded-lg border px-4 py-3 min-w-[240px] max-w-[320px]",
          "bg-card/80 backdrop-blur transition-all duration-300",
          glowMap[nodeData.type],
          bgMap[nodeData.type]
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", iconColorMap[nodeData.type])} />
          <span className="text-sm font-medium text-foreground truncate">
            {nodeData.label}
          </span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground truncate">
          {nodeData.fullPath}
        </div>
        {nodeData.reason && (
          <div className="mt-1 text-[10px] text-muted-foreground/70 truncate">
            {nodeData.reason}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const DirectoryNode = memo(DirectoryNodeComponent);

export const nodeTypes = {
  directoryNode: DirectoryNode,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/SessionMapNodes.tsx
git commit -m "feat(map): custom DirectoryNode with frosted glass + glow effects"
```

---

### Task 4: SessionMap Component — React Flow Canvas

**Files:**
- Create: `frontend/src/components/results/SessionMap.tsx`

- [ ] **Step 1: Create the map component**

```typescript
// frontend/src/components/results/SessionMap.tsx
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSandbox } from "@/hooks/useSandboxSession";
import { useMapGraph } from "@/hooks/useMapGraph";
import { nodeTypes } from "./SessionMapNodes";
import { FolderOpen } from "lucide-react";

export function SessionMap() {
  const session = useSandbox();
  const { nodes, edges } = useMapGraph(session.derived);

  if (!session.hasChanges) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FolderOpen className="h-16 w-16 text-muted-foreground/30 mb-6" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          Session Map
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Start making decisions in the Similar Directories or Duplicate Files
          tabs. Your changes will appear here as a visual plan before anything
          touches disk.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[600px] rounded-lg border border-border overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          animated: true,
          style: { strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--muted-foreground) / 0.15)"
        />
        <Controls
          className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
          position="bottom-left"
        />
        <MiniMap
          className="!bg-card/80 !border-border"
          nodeColor={(node) => {
            const type = (node.data as { type?: string })?.type;
            if (type === "delete") return "hsl(var(--destructive))";
            if (type === "destination") return "hsl(210, 100%, 60%)";
            if (type === "keeper") return "hsl(var(--success))";
            return "hsl(var(--primary))";
          }}
          maskColor="hsl(var(--background) / 0.8)"
          position="bottom-right"
        />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Add React Flow CSS import**

The `@xyflow/react/dist/style.css` import in the component handles the base styles. If this causes build issues, add it to `frontend/src/index.css` instead:

```css
@import "@xyflow/react/dist/style.css";
```

- [ ] **Step 3: Verify TypeScript compiles and builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/SessionMap.tsx
git commit -m "feat(map): SessionMap canvas with dark theme, minimap, controls"
```

---

### Task 5: Add Session Map Tab to ScanResults

**Files:**
- Modify: `frontend/src/pages/ScanResults.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/ScanResults.tsx` to find the Tabs section.

- [ ] **Step 2: Add the Map tab**

Add import:

```typescript
import { SessionMap } from "@/components/results/SessionMap";
import { Map } from "lucide-react";  // add to existing lucide import
```

In the `<TabsList>`, add a new tab trigger after "Similar Directories":

```typescript
<TabsTrigger value="map">
  <Map className="h-4 w-4 mr-1" />
  Session Map
</TabsTrigger>
```

Add the corresponding `<TabsContent>`:

```typescript
<TabsContent value="map">
  <SessionMap />
</TabsContent>
```

Place it after the Similar Directories `TabsContent` block.

- [ ] **Step 3: Verify build**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ScanResults.tsx
git commit -m "feat(map): add Session Map tab to ScanResults"
```

---

### Task 6: Commit Progress Overlay

**Files:**
- Create: `frontend/src/components/results/CommitProgressOverlay.tsx`
- Modify: `frontend/src/components/results/SessionSummaryBar.tsx`

- [ ] **Step 1: Create the overlay component**

```typescript
// frontend/src/components/results/CommitProgressOverlay.tsx
import { Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CommitPhase = "dry-run" | "executing" | "completed" | "rolled-back" | "failed-partial";

interface CommitProgressOverlayProps {
  phase: CommitPhase;
  error?: string;
  rollbackError?: string;
  onClose: () => void;
}

const phaseConfig: Record<CommitPhase, { icon: typeof Loader2; label: string; color: string }> = {
  "dry-run": { icon: Loader2, label: "Validating operations...", color: "text-primary" },
  executing: { icon: Loader2, label: "Executing operations...", color: "text-primary" },
  completed: { icon: CheckCircle, label: "All operations completed successfully", color: "text-success" },
  "rolled-back": { icon: AlertTriangle, label: "Operations rolled back", color: "text-amber-400" },
  "failed-partial": { icon: XCircle, label: "Partial failure — some operations could not be rolled back", color: "text-destructive" },
};

export function CommitProgressOverlay({
  phase,
  error,
  rollbackError,
  onClose,
}: CommitProgressOverlayProps) {
  const config = phaseConfig[phase];
  const Icon = config.icon;
  const isActive = phase === "dry-run" || phase === "executing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 space-y-4">
        <div className="flex flex-col items-center text-center gap-4">
          <Icon
            className={cn(
              "h-12 w-12",
              config.color,
              isActive && "animate-spin"
            )}
          />
          <h3 className={cn("text-lg font-semibold", config.color)}>
            {config.label}
          </h3>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {rollbackError && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-400">
            <strong>Rollback issue:</strong> {rollbackError}
          </div>
        )}

        {!isActive && (
          <div className="flex justify-center pt-2">
            <Button onClick={onClose}>
              {phase === "completed" ? "Done" : "Close"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire overlay into SessionSummaryBar**

Modify `frontend/src/components/results/SessionSummaryBar.tsx`:

Add import:

```typescript
import { useState } from "react";
import { CommitProgressOverlay } from "./CommitProgressOverlay";
```

Add state for commit progress:

```typescript
const [commitPhase, setCommitPhase] = useState<string | null>(null);
const [commitError, setCommitError] = useState<string | undefined>();
```

Update the `handleCommit` function to show the overlay:

```typescript
const handleCommit = async () => {
  if (!session.sessionId) return;
  if (!confirm("Commit all changes to disk? This will execute all planned operations.")) return;
  
  setCommitPhase("executing");
  setCommitError(undefined);
  
  try {
    await commitMutation.mutateAsync(session.sessionId);
    setCommitPhase("completed");
  } catch (err) {
    setCommitPhase("rolled-back");
    setCommitError(err instanceof Error ? err.message : "Unknown error");
  }
};
```

Add the overlay rendering at the end of the component return, just before the closing fragment or div:

```typescript
{commitPhase && (
  <CommitProgressOverlay
    phase={commitPhase as any}
    error={commitError}
    onClose={() => {
      setCommitPhase(null);
      if (commitPhase === "completed") {
        session.discard(); // Clear session on success
      }
    }}
  />
)}
```

Change `commitMutation.mutate` to `commitMutation.mutateAsync` usage (or handle via onSuccess/onError callbacks in the mutation).

- [ ] **Step 3: Verify build**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/CommitProgressOverlay.tsx frontend/src/components/results/SessionSummaryBar.tsx
git commit -m "feat(map): commit progress overlay with phase indicators"
```

---

### Task 7: Deploy and Verify

**Files:** None (deployment)

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy**

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude=dist --exclude=.venv /Users/jackf/Documents/Development/Collective/ root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build --no-cache -f docker/Dockerfile -t collective:latest ."
ssh root@192.168.50.45 "docker stop collective && docker rm collective && docker run -d --name collective --restart unless-stopped -p 8080:8080 -v /mnt/user:/mnt/user -v /mnt/user/appdata/collective:/data collective:latest"
```

- [ ] **Step 3: Verify**

```bash
ssh root@192.168.50.45 "docker logs collective --tail 15 2>&1"
```

Expected: All processes running.

- [ ] **Step 4: Test the Map**

1. Open a completed scan
2. Go to Similar Directories tab → promote a hub → tag & move to archive
3. Switch to Session Map tab → see nodes: source (green), destination (blue), delete (red), with animated edges
4. Undo → nodes disappear
5. Redo → nodes reappear
6. Add more commands → map updates in real-time
7. Test empty state (no commands) → shows placeholder message
