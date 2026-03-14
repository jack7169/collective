import { useState } from "react";
import {
  Play,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { useActions, useConfirmAction, useDryRun } from "@/api/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }
> = {
  planned: { icon: Clock, variant: "secondary" },
  dry_run: { icon: Play, variant: "outline" },
  confirmed: { icon: CheckCircle2, variant: "warning" },
  executing: { icon: Loader2, variant: "default" },
  completed: { icon: CheckCircle2, variant: "success" },
  failed: { icon: XCircle, variant: "destructive" },
};

export function ActionsLog() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmActionId, setConfirmActionId] = useState<number | null>(null);

  const { data, isLoading } = useActions(
    undefined,
    statusFilter === "all" ? undefined : statusFilter
  );
  const confirmAction = useConfirmAction();
  const dryRunMutation = useDryRun();

  const actions = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Actions Log</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage file operations
          </p>
        </div>

        {/* Status filter */}
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="dry_run">Dry Run</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="executing">Executing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading actions...
            </div>
          ) : actions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                No actions found
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Source</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => {
                  const isExpanded = expandedId === action.id;
                  const config = statusConfig[action.status] ?? statusConfig["planned"]!;
                  const StatusIcon = config.icon;

                  return (
                    <>
                      <TableRow
                        key={action.id}
                        className="cursor-pointer"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : action.id)
                        }
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-[200px]">
                          {action.source_path}
                        </TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-[200px]">
                          {action.dest_path}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {action.action_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={config.variant} className="text-xs">
                            <StatusIcon
                              className={cn(
                                "h-3 w-3 mr-1",
                                action.status === "executing" && "animate-spin"
                              )}
                            />
                            {action.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(action.created_at)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {action.status === "planned" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  dryRunMutation.mutate(String(action.id))
                                }
                                disabled={dryRunMutation.isPending}
                              >
                                <Play className="h-3 w-3" />
                                Dry Run
                              </Button>
                            )}
                            {(action.status === "dry_run" ||
                              action.status === "confirmed") && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  setConfirmActionId(action.id)
                                }
                                disabled={confirmAction.isPending}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Execute
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded details */}
                      {isExpanded && (
                        <TableRow key={`${action.id}-details`}>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="space-y-3 py-2">
                              {action.dry_run_output && (
                                <div>
                                  <span className="text-xs font-medium text-muted-foreground">
                                    Dry Run Output:
                                  </span>
                                  <ScrollArea className="mt-1 h-32">
                                    <pre className="rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                                      {action.dry_run_output}
                                    </pre>
                                  </ScrollArea>
                                </div>
                              )}
                              {action.error_message && (
                                <div>
                                  <span className="text-xs font-medium text-destructive">
                                    Error:
                                  </span>
                                  <pre className="mt-1 rounded bg-destructive/10 p-3 font-mono text-xs text-destructive whitespace-pre-wrap">
                                    {action.error_message}
                                  </pre>
                                </div>
                              )}
                              {action.notes && (
                                <div>
                                  <span className="text-xs font-medium text-muted-foreground">
                                    Notes:
                                  </span>
                                  <p className="mt-1 text-sm">{action.notes}</p>
                                </div>
                              )}
                              {!action.dry_run_output &&
                                !action.error_message &&
                                !action.notes && (
                                  <p className="text-sm text-muted-foreground">
                                    No additional details available.
                                  </p>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirm execution dialog */}
      <ConfirmDialog
        open={!!confirmActionId}
        onOpenChange={(open) => {
          if (!open) setConfirmActionId(null);
        }}
        title="Execute Action"
        description="Are you sure you want to execute this action? This will modify files on disk and cannot be easily undone."
        confirmLabel="Execute"
        variant="default"
        onConfirm={() => {
          if (confirmActionId) {
            confirmAction.mutate(String(confirmActionId));
            setConfirmActionId(null);
          }
        }}
      />
    </div>
  );
}
