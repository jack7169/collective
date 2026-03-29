import {
  AlertTriangle,
  CheckCircle2,
  Shield,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/format";
import type { AssimilatePreview } from "@/api/types";

interface CommitPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: AssimilatePreview | null;
  onAcknowledge: (checksums: string[]) => void;
  onCommit: () => void;
  isCommitting: boolean;
}

export function CommitPreview({
  open,
  onOpenChange,
  preview,
  onAcknowledge,
  onCommit,
  isCommitting,
}: CommitPreviewProps) {
  if (!preview) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Commit Preview</DialogTitle>
          <DialogDescription>
            Review operations before applying to disk
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-muted p-3">
              <p className="text-2xl font-bold">{formatNumber(preview.operations_count)}</p>
              <p className="text-xs text-muted-foreground">Operations</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-2xl font-bold">{formatBytes(preview.bytes_affected)}</p>
              <p className="text-xs text-muted-foreground">Bytes Affected</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-2xl font-bold">{formatNumber(preview.checksums_preserved)}</p>
              <p className="text-xs text-muted-foreground">of {formatNumber(preview.checksums_total)} preserved</p>
            </div>
          </div>

          {/* Hash verification */}
          {preview.checksums_lost === 0 ? (
            <div className="rounded-md border border-success/50 bg-success/10 p-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span className="text-sm text-success">
                All {formatNumber(preview.checksums_total)} unique checksums preserved
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <span className="text-sm font-medium text-destructive">
                  {formatNumber(preview.checksums_lost)} checksum{preview.checksums_lost > 1 ? "s" : ""} will be lost
                </span>
              </div>

              <ScrollArea className="max-h-48">
                <div className="space-y-2">
                  {preview.warnings.map((w) => (
                    <div
                      key={w.checksum}
                      className="flex items-start gap-2 rounded bg-background/50 p-2 text-xs"
                    >
                      <Checkbox
                        checked={w.acknowledged}
                        onCheckedChange={() => {
                          if (!w.acknowledged) {
                            onAcknowledge([w.checksum]);
                          }
                        }}
                      />
                      <div>
                        <span className="font-mono text-muted-foreground">
                          {w.checksum.slice(0, 12)}...
                        </span>
                        {w.files.map((f) => (
                          <div key={f} className="font-mono text-destructive truncate">
                            {f}
                          </div>
                        ))}
                        {w.acknowledged && (
                          <Badge variant="outline" className="text-[9px] mt-1">
                            <Shield className="h-2.5 w-2.5 mr-1" />
                            Acknowledged
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Operations list */}
          <ScrollArea className="max-h-48">
            <div className="space-y-1">
              {preview.operations.map((op, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/50">
                  <Badge variant="outline" className="text-[9px]">{op.type}</Badge>
                  <span className="font-mono truncate">{op.source}</span>
                  {op.dest && (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono truncate">{op.dest}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Commit button */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={onCommit}
              disabled={!preview.ready_to_commit || isCommitting}
              variant={preview.ready_to_commit ? "default" : "destructive"}
            >
              {isCommitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Committing...
                </>
              ) : preview.ready_to_commit ? (
                "Commit Changes"
              ) : (
                "Acknowledge all warnings first"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
