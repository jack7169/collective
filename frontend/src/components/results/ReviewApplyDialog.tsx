import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/format";
import type { KeeperDecision } from "@/hooks/useKeeperSelection";

interface ReviewApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decisions: KeeperDecision[];
  totalReclaimable: number;
  totalDeleteFiles: number;
  onApply: () => Promise<void>;
}

interface DirectoryGroup {
  directory: string;
  files: string[];
}

function groupByDirectory(paths: string[]): DirectoryGroup[] {
  const map = new Map<string, string[]>();
  for (const p of paths) {
    const lastSlash = p.lastIndexOf("/");
    const dir = lastSlash > 0 ? p.slice(0, lastSlash) : "/";
    const existing = map.get(dir);
    if (existing) {
      existing.push(p);
    } else {
      map.set(dir, [p]);
    }
  }
  return Array.from(map.entries())
    .map(([directory, files]) => ({ directory, files }))
    .sort((a, b) => b.files.length - a.files.length);
}

function DirectoryGroupList({
  groups,
  colorClass,
}: {
  groups: DirectoryGroup[];
  colorClass: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <div key={g.directory}>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 text-left"
            onClick={() => toggle(g.directory)}
          >
            {expanded.has(g.directory) ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-mono text-xs text-foreground break-all flex-1">
              {g.directory}/
            </span>
            <span className={`text-xs font-medium shrink-0 ${colorClass}`}>
              {g.files.length} file{g.files.length > 1 ? "s" : ""}
            </span>
          </button>
          {expanded.has(g.directory) && (
            <div className="ml-6 flex flex-col gap-0.5 mb-1">
              {g.files.map((f) => (
                <div
                  key={f}
                  className="font-mono text-[11px] text-muted-foreground px-2 py-0.5"
                >
                  {f.split("/").pop()}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ReviewApplyDialog({
  open,
  onOpenChange,
  decisions,
  totalReclaimable,
  totalDeleteFiles,
  onApply,
}: ReviewApplyDialogProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    deletedCount: number;
    reclaimedBytes: number;
  } | null>(null);

  const keepPaths = decisions.map((d) => d.keeperPath);
  const deletePaths = decisions.flatMap((d) => d.deletePaths);
  const keepGroups = groupByDirectory(keepPaths);
  const deleteGroups = groupByDirectory(deletePaths);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply();
      setResult({
        success: true,
        deletedCount: totalDeleteFiles,
        reclaimedBytes: totalReclaimable,
      });
    } catch {
      setResult({ success: false, deletedCount: 0, reclaimedBytes: 0 });
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!isApplying) {
      setResult(null);
      onOpenChange(open);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review & Apply</DialogTitle>
          <DialogDescription>
            Review all changes before applying to disk. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            {result.success ? (
              <>
                <div className="text-4xl">✓</div>
                <p className="text-lg font-semibold text-success">
                  Successfully deleted {formatNumber(result.deletedCount)} files
                </p>
                <p className="text-muted-foreground">
                  Reclaimed {formatBytes(result.reclaimedBytes)}
                </p>
                <Button onClick={() => handleClose(false)}>Done</Button>
              </>
            ) : (
              <>
                <div className="text-4xl">✗</div>
                <p className="text-lg font-semibold text-destructive">
                  Some operations failed
                </p>
                <p className="text-muted-foreground">
                  Check the action log for details.
                </p>
                <Button onClick={() => handleClose(false)}>Close</Button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex items-center gap-6 py-3 px-4 rounded-lg bg-muted/50 text-sm">
              <div>
                <span className="text-muted-foreground">Keeping </span>
                <span className="font-semibold text-success">
                  {formatNumber(keepPaths.length)} files
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Deleting </span>
                <span className="font-semibold text-destructive">
                  {formatNumber(deletePaths.length)} files
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Reclaiming </span>
                <span className="font-semibold text-destructive">
                  {formatBytes(totalReclaimable)}
                </span>
              </div>
            </div>

            {/* Two-column analysis */}
            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-success mb-2">
                  Files Being Kept ({keepPaths.length})
                </h3>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  <DirectoryGroupList
                    groups={keepGroups}
                    colorClass="text-success"
                  />
                </ScrollArea>
              </div>
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-destructive mb-2">
                  Files Being Deleted ({deletePaths.length})
                </h3>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  <DirectoryGroupList
                    groups={deleteGroups}
                    colorClass="text-destructive"
                  />
                </ScrollArea>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={isApplying}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleApply}
                disabled={isApplying}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  `Apply to Disk — Delete ${formatNumber(deletePaths.length)} Files`
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
