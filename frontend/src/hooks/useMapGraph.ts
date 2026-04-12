import { useMemo } from "react";
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";
import type { DerivedSandboxState } from "@/lib/sandboxCommands";

export interface MapNodeData extends Record<string, unknown> {
  label: string;
  fullPath: string;
  type: "source" | "destination" | "delete" | "keeper";
  reason?: string;
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 72;

function layoutGraph(
  nodes: Node<MapNodeData>[],
  edges: Edge[]
): Node<MapNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });

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

function dirNodeId(dir: string): string {
  return `dir:${dir}`;
}

export function useMapGraph(derived: DerivedSandboxState): {
  nodes: Node<MapNodeData>[];
  edges: Edge[];
} {
  return useMemo(() => {
    const nodes: Node<MapNodeData>[] = [];
    const edges: Edge[] = [];

    // Delete nodes — one per markedForDelete entry
    for (const [dir, reason] of derived.markedForDelete) {
      nodes.push({
        id: dirNodeId(dir),
        type: "mapNode",
        position: { x: 0, y: 0 },
        data: {
          label: dir.split("/").pop() ?? dir,
          fullPath: dir,
          type: "delete",
          reason,
        },
      });
    }

    // Source / keeper nodes — taggedOriginals not already in markedForDelete
    for (const dir of derived.taggedOriginals) {
      if (derived.markedForDelete.has(dir)) continue;

      const hasDest = derived.moveDestinations.has(dir);
      nodes.push({
        id: dirNodeId(dir),
        type: "mapNode",
        position: { x: 0, y: 0 },
        data: {
          label: dir.split("/").pop() ?? dir,
          fullPath: dir,
          type: hasDest ? "source" : "keeper",
        },
      });
    }

    // Destination nodes — deduplicated values from moveDestinations
    const seenDests = new Set<string>();
    for (const dest of derived.moveDestinations.values()) {
      if (!seenDests.has(dest)) {
        seenDests.add(dest);
        nodes.push({
          id: dirNodeId(dest),
          type: "mapNode",
          position: { x: 0, y: 0 },
          data: {
            label: dest.split("/").pop() ?? dest,
            fullPath: dest,
            type: "destination",
          },
        });
      }
    }

    // Move edges — source → destination, animated, primary color
    for (const [sourceDir, destDir] of derived.moveDestinations) {
      edges.push({
        id: `move:${sourceDir}→${destDir}`,
        source: dirNodeId(sourceDir),
        target: dirNodeId(destDir),
        animated: true,
        style: {
          stroke: "hsl(var(--primary))",
          strokeWidth: 2,
        },
      });
    }

    // Delete-reference edges — dashed edge from delete node → original dir node
    // Triggered when reason matches "Duplicate of {dir}"
    for (const [dir, reason] of derived.markedForDelete) {
      const match = reason.match(/^Duplicate of (.+)$/);
      if (match) {
        const originalDir = match[1];
        const targetId = dirNodeId(originalDir);
        const targetExists = nodes.some((n) => n.id === targetId);
        if (targetExists) {
          edges.push({
            id: `ref:${dir}→${originalDir}`,
            source: dirNodeId(dir),
            target: targetId,
            animated: false,
            style: {
              stroke: "hsl(var(--destructive))",
              strokeDasharray: "5 5",
            },
          });
        }
      }
    }

    const positionedNodes = layoutGraph(nodes, edges);

    return { nodes: positionedNodes, edges };
  }, [derived]);
}
