import { useState } from "react";
import { ArrowRight, Trash2, FolderOutput } from "lucide-react";
import { useSandbox } from "@/hooks/useSandboxSession";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PathPicker } from "@/components/scan/PathPicker";
import { formatBytes } from "@/lib/format";
import type { PeerEntry } from "@/lib/groupHubs";

interface TagMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scanId: string;
  hubDirectory: string;
  peers: PeerEntry[];
  totalReclaimable: number;
}

export function TagMoveDialog({
  open,
  onOpenChange,
  scanId,
  hubDirectory,
  peers,
  totalReclaimable,
}: TagMoveDialogProps) {
  const [destPaths, setDestPaths] = useState<string[]>([]);
  const dest = destPaths[0] ?? "";
  const session = useSandbox();

  const handleApply = () => {
    // Tag hub as original
    session.execute({ type: "tag-original", directory: hubDirectory });

    // Set move destination (if selected)
    if (dest) {
      session.execute({ type: "set-move-dest", sourceDir: hubDirectory, destDir: dest });
    }

    // Mark all peers for deletion
    for (const peer of peers) {
      session.execute({
        type: "mark-delete",
        directory: peer.directory,
        reason: `Duplicate of ${hubDirectory}`,
      });
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOutput className="h-5 w-5" />
            Tag & Move to Archive
          </DialogTitle>
          <DialogDescription>
            Extract the canonical copy and delete redundant peers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Source (original)
            </label>
            <div className="mt-1 font-mono text-xs bg-muted px-3 py-2 rounded break-all">
              {hubDirectory}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Move to
            </label>
            <div className="mt-1">
              <PathPicker selectedPaths={destPaths} onChange={setDestPaths} />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ArrowRight className="h-4 w-4 text-primary" />
              <span>
                Move to{" "}
                <span className="font-mono text-xs">{dest || "..."}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-destructive">
              <Trash2 className="h-4 w-4" />
              <span>
                Delete {peers.length} peer director
                {peers.length > 1 ? "ies" : "y"} (~
                {formatBytes(totalReclaimable)} freed)
              </span>
            </div>
            <div className="ml-6 space-y-0.5">
              {peers.map((p) => (
                <div
                  key={p.directory}
                  className="font-mono text-[10px] text-muted-foreground truncate"
                >
                  {p.directory}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!dest}>
              <FolderOutput className="h-4 w-4" />
              Stage Move & Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
