/**
 * Action Queue Panel — floating panel that shows queued filesystem changes.
 * Users build up operations (move, copy, delete, reflink, etc.) and then
 * preview/apply them all at once via a confirmation modal.
 */
import { useState } from "react";
import {
  ArrowRight,
  Copy,
  Trash2,
  Link,
  Link2,
  GripVertical,
  X,
  Play,
  Eye,
  CheckCircle,
  XCircle,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QueuedAction, QueueExecutionResult } from "@/hooks/useActionQueue";

const ACTION_ICONS: Record<string, typeof ArrowRight> = {
  move: ArrowRight,
  copy: Copy,
  delete: Trash2,
  hardlink: Link,
  symlink: Link2,
  reflink: Link2,
  merge: Layers,
};

const ACTION_COLORS: Record<string, string> = {
  move: "text-blue-400",
  copy: "text-green-400",
  delete: "text-red-400",
  hardlink: "text-purple-400",
  symlink: "text-yellow-400",
  reflink: "text-cyan-400",
  merge: "text-orange-400",
};

interface ActionQueuePanelProps {
  queue: QueuedAction[];
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
  onExecute: (dryRun: boolean) => void;
  isExecuting: boolean;
  lastResult: QueueExecutionResult | null;
  totalEstimatedSize: number;
}

export function ActionQueuePanel({
  queue,
  onRemove,
  onClear,
  onExecute,
  isExecuting,
  lastResult,
  totalEstimatedSize,
}: ActionQueuePanelProps) {
  const [showResults, setShowResults] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (queue.length === 0 && !lastResult) return null;

  return (
    <>
      <Card className="fixed bottom-4 right-4 w-96 z-50 border-primary/30 shadow-2xl bg-card/95 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Action Queue ({queue.length})
            </CardTitle>
            <div className="flex gap-1">
              {lastResult && (
                <Button size="sm" variant="ghost" onClick={() => setShowResults(true)}>
                  <Eye className="h-3 w-3" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClear}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {totalEstimatedSize > 0 && (
            <p className="text-xs text-muted-foreground">
              ~{formatBytes(totalEstimatedSize)} affected
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          <ScrollArea className="max-h-48">
            <div className="space-y-1">
              {queue.map((action) => {
                const Icon = ACTION_ICONS[action.type] || ArrowRight;
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/50 text-xs"
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab" />
                    <Icon className={cn("h-3 w-3 shrink-0", ACTION_COLORS[action.type])} />
                    <span className="flex-1 truncate font-mono">{action.description}</span>
                    <button
                      onClick={() => onRemove(action.id)}
                      className="p-0.5 hover:bg-destructive/20 rounded"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {queue.length > 0 && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onExecute(true)}
                disabled={isExecuting}
              >
                <Eye className="h-3 w-3" />
                {isExecuting ? "Running..." : "Preview"}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={() => setShowConfirm(true)}
                disabled={isExecuting}
              >
                <Play className="h-3 w-3" />
                Apply All
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply {queue.length} Actions?</DialogTitle>
            <DialogDescription>
              The following filesystem changes will be executed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {queue.map((action) => {
                const Icon = ACTION_ICONS[action.type] || ArrowRight;
                return (
                  <div key={action.id} className="flex items-center gap-2 text-sm">
                    <Icon className={cn("h-4 w-4", ACTION_COLORS[action.type])} />
                    <Badge variant="outline" className="text-[10px]">
                      {action.type}
                    </Badge>
                    <span className="font-mono text-xs truncate">{action.description}</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowConfirm(false);
                onExecute(false);
              }}
              disabled={isExecuting}
            >
              {isExecuting ? "Executing..." : "Confirm & Apply"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Results Modal */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Execution Results</DialogTitle>
            <DialogDescription>
              {lastResult &&
                `${lastResult.succeeded} succeeded, ${lastResult.failed} failed`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {lastResult?.results.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  {r.status === "success" ? (
                    <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  ) : r.status === "error" ? (
                    <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <Eye className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-mono text-xs">{r.action.description}</p>
                    {r.message && (
                      <pre className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap">
                        {r.message}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
