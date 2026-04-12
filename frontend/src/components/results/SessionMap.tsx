import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from "@xyflow/react";
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
      <div className="flex h-[600px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-background text-center">
        <FolderOpen className="h-12 w-12 text-muted-foreground/50" />
        <p className="max-w-sm text-sm text-muted-foreground">
          Start making decisions in the Similar Directories or Duplicate Files
          tabs. Your changes will appear here as a visual plan before anything
          touches disk.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[600px] overflow-hidden rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="hsl(var(--muted-foreground) / 0.3)" />
        <Controls
          className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        <MiniMap
          position="bottom-right"
          nodeColor={(node) => {
            const type = (node.data as { type?: string }).type;
            switch (type) {
              case "delete":
                return "hsl(var(--destructive))";
              case "destination":
                return "hsl(217 91% 60%)"; // blue-400
              case "keeper":
                return "hsl(142 71% 45%)"; // green-400
              case "source":
              default:
                return "hsl(var(--primary))";
            }
          }}
        />
      </ReactFlow>
    </div>
  );
}
