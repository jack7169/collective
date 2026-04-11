import { useState } from "react";
import { Loader2, ArrowRight, Trash2, FolderOutput } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/api/client";
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
  const queryClient = useQueryClient();

  const executeMutation = useMutation({
    mutationFn: async () => {
      const scanIdNum = Number(scanId);

      // 1. Tag as original
      await post(`/scans/${scanId}/tag-originals`, {
        original_paths: [hubDirectory],
      });

      // 2. Move hub to destination
      if (dest) {
        const dirName = hubDirectory.split("/").pop() || "archive";
        const moveAction = await post<{ id: number }>("/actions", {
          scan_id: scanIdNum,
          action_type: "move",
          source_path: hubDirectory,
          dest_path: dest.replace(/\/$/, "") + "/" + dirName,
          notes: "Tag & Move: extract to archive",
        });
        await post(`/actions/${moveAction.id}/confirm`, {});
      }

      // 3. Delete all peer directories
      for (const peer of peers) {
        const deleteAction = await post<{ id: number }>("/actions", {
          scan_id: scanIdNum,
          action_type: "delete",
          source_path: peer.directory,
          notes: `Tag & Move: delete peer (original: ${hubDirectory})`,
        });
        await post(`/actions/${deleteAction.id}/confirm`, {});
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans", scanId] });
      onOpenChange(false);
    },
  });

  const handleApply = () => {
    executeMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!executeMutation.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOutput className="h-5 w-5" />
            Tag & Move to Archive
          </DialogTitle>
          <DialogDescription>
            Extract the canonical copy and delete redundant peers.
          </DialogDescription>
        </DialogHeader>

        {executeMutation.isSuccess ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="text-3xl">✓</div>
            <p className="text-lg font-semibold text-success">Done</p>
            <p className="text-sm text-muted-foreground">
              Moved original and deleted {peers.length} peer
              {peers.length > 1 ? "s" : ""}
            </p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
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
                disabled={executeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleApply}
                disabled={!dest || executeMutation.isPending}
              >
                {executeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <FolderOutput className="h-4 w-4" />
                    Move & Delete Peers
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
