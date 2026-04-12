import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FolderOutput, Trash2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface MapNodeData {
  label: string;
  fullPath: string;
  type: "source" | "destination" | "delete" | "keeper";
  reason?: string;
}

const glowStyles: Record<MapNodeData["type"], string> = {
  source:
    "shadow-[0_0_15px_rgba(124,58,237,0.15)] border-primary/40 bg-primary/5",
  destination:
    "shadow-[0_0_15px_rgba(59,130,246,0.15)] border-blue-400/40 bg-blue-500/5",
  delete:
    "shadow-[0_0_15px_rgba(239,68,68,0.15)] border-destructive/40 bg-destructive/5",
  keeper:
    "shadow-[0_0_15px_rgba(34,197,94,0.15)] border-success/40 bg-success/5",
};

const iconStyles: Record<MapNodeData["type"], string> = {
  source: "text-primary",
  destination: "text-blue-400",
  delete: "text-destructive",
  keeper: "text-green-400",
};

function NodeIcon({ type }: { type: MapNodeData["type"] }) {
  const cls = cn("w-4 h-4 shrink-0", iconStyles[type]);
  switch (type) {
    case "delete":
      return <Trash2 className={cls} />;
    case "keeper":
      return <Shield className={cls} />;
    default:
      return <FolderOutput className={cls} />;
  }
}

function DirectoryNodeComponent(props: NodeProps) {
  const data = props.data as unknown as MapNodeData;
  const { label, fullPath, type, reason } = data;

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card/80 backdrop-blur px-3 py-2.5",
        "min-w-[160px] max-w-[260px]",
        glowStyles[type],
      )}
    >
      {/* Target handle — left side */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      {/* Content */}
      <div className="flex items-start gap-2">
        <NodeIcon type={type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{label}</p>
          <p className="truncate font-mono text-[10px] leading-snug text-muted-foreground">
            {fullPath}
          </p>
          {reason && (
            <p className="mt-1 truncate text-[10px] leading-snug text-muted-foreground/70 italic">
              {reason}
            </p>
          )}
        </div>
      </div>

      {/* Source handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
}

export const DirectoryNode = memo(DirectoryNodeComponent);

export const nodeTypes = {
  directoryNode: DirectoryNode,
};
