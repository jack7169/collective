import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  XCircle,
  CheckCircle2,
  FileSearch,
  Hash,
  BarChart3,
  Files,
  FolderOpen,
  HardDrive,
  Layers,
  AlertTriangle,
  RotateCcw,
  Clock,
  Timer,
} from "lucide-react";
import { useScanProgress } from "@/api/websocket";
import { useScan, useCancelScan, useResumeScan } from "@/api/scans";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const phaseConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string; chipColor: string }
> = {
  hashing: { icon: Hash, label: "Hashing Files", color: "text-primary", chipColor: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  parsing: { icon: FileSearch, label: "Parsing Results", color: "text-amber-400", chipColor: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  analyzing: { icon: BarChart3, label: "Analyzing Similarities", color: "text-cyan-400", chipColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-success", chipColor: "bg-green-500/10 text-green-400 border-green-500/20" },
  failed: { icon: XCircle, label: "Failed", color: "text-destructive", chipColor: "bg-red-500/10 text-red-400 border-red-500/20" },
  cancelled: { icon: XCircle, label: "Cancelled", color: "text-muted-foreground", chipColor: "bg-muted text-muted-foreground border-border" },
  interrupted: { icon: AlertTriangle, label: "Interrupted", color: "text-amber-400", chipColor: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function estimateRemaining(elapsed: number, percent: number): string | null {
  if (percent <= 1 || elapsed < 10) return null; // Not enough data
  const totalEstimated = (elapsed / percent) * 100;
  const remaining = Math.max(0, Math.round(totalEstimated - elapsed));
  if (remaining < 5) return "< 5s";
  return `~${formatElapsed(remaining)}`;
}

export function ScanProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { progress, isConnected, reconnect } = useScanProgress(id);
  const { data: scan } = useScan(id);
  const cancelScan = useCancelScan();
  const resumeScan = useResumeScan();

  // Map backend status to display phase
  const rawStatus = progress?.status ?? scan?.status ?? "pending";
  const phase = rawStatus === "running" ? "hashing" : rawStatus;

  // Auto-navigate when completed (not cancelled — user may want to resume)
  useEffect(() => {
    if (rawStatus === "completed") {
      const timer = setTimeout(() => {
        navigate(`/scans/${id}`, { replace: true });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [rawStatus, id, navigate]);

  const phaseInfo = phaseConfig[phase] ?? phaseConfig["hashing"]!;
  const PhaseIcon = phaseInfo.icon;
  const percent = progress?.progress_percent ?? scan?.progress_percent ?? 0;
  const runElapsed = progress?.elapsed_seconds ?? null;
  const totalElapsed = progress?.total_elapsed_seconds ?? null;
  const isActive = ["running", "parsing", "analyzing", "pending"].includes(rawStatus);

  // Show "--" for metrics that aren't available yet during active scans
  function metricValue(
    val: number | null | undefined,
    formatter: (n: number) => string
  ): string {
    if (val != null) return formatter(val);
    if (isActive) return "--";
    return formatter(0);
  }

  const eta = totalElapsed != null && percent > 0 ? estimateRemaining(totalElapsed, percent) : null;
  const isResumed = totalElapsed != null && runElapsed != null && totalElapsed > runElapsed + 5;

  const metricCards = [
    {
      label: "Files",
      value: metricValue(progress?.total_files ?? scan?.total_files, formatNumber),
      icon: Files,
      borderColor: "border-l-blue-500",
      iconColor: "text-blue-500",
    },
    {
      label: "Directories",
      value: metricValue(progress?.total_dirs ?? scan?.total_dirs, formatNumber),
      icon: FolderOpen,
      borderColor: "border-l-green-500",
      iconColor: "text-green-500",
    },
    {
      label: "Total Size",
      value: metricValue(progress?.total_size ?? scan?.total_size, formatBytes),
      icon: HardDrive,
      borderColor: "border-l-amber-500",
      iconColor: "text-amber-500",
    },
    {
      label: "Duplicates",
      value: metricValue(progress?.duplicates_found ?? scan?.duplicates_found, formatNumber),
      icon: Layers,
      borderColor: "border-l-cyan-500",
      iconColor: "text-cyan-500",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {scan?.name ?? "Scanning..."}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {phase === "completed"
            ? "Scan complete! Redirecting to results..."
            : phase === "failed"
              ? "Scan failed"
              : "Scanning for duplicates and similar directories"}
        </p>
      </div>

      {/* Progress Card */}
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {phase !== "completed" && phase !== "failed" && phase !== "interrupted" ? (
                  <Loader2 className={cn("h-5 w-5 animate-spin", phaseInfo.color)} />
                ) : (
                  <PhaseIcon className={cn("h-5 w-5", phaseInfo.color)} />
                )}
                <Badge variant="outline" className={cn("text-xs", phaseInfo.chipColor)}>
                  <PhaseIcon className="mr-1 h-3 w-3" />
                  {phaseInfo.label}
                </Badge>
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {percent.toFixed(1)}%
              </span>
            </div>

            <Progress
              value={percent}
              className={cn(
                "h-2",
                percent < 2 && isActive
                  ? "[&>div]:animate-pulse [&>div]:w-full [&>div]:bg-primary/40"
                  : "[&>div]:bg-primary"
              )}
            />

            {/* Elapsed time + ETA bar — always visible during active scan */}
            {isActive && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span className="tabular-nums">
                      Run: {runElapsed != null ? formatElapsed(runElapsed) : "--"}
                    </span>
                  </div>
                  {isResumed && (
                    <span className="tabular-nums text-muted-foreground/70">
                      Total: {totalElapsed != null ? formatElapsed(totalElapsed) : "--"}
                    </span>
                  )}
                </div>
                {eta ? (
                  <div className="flex items-center gap-1.5">
                    <Timer className="h-3 w-3" />
                    <span className="tabular-nums">
                      Remaining: {eta}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground/50">Estimating...</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className={`border-l-4 ${card.borderColor}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${card.iconColor}`} />
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {card.label}
                    </p>
                    <p className="text-lg font-bold leading-tight">{card.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Live Output Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Scanner Output</CardTitle>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  isConnected ? "bg-success" : "bg-destructive"
                )}
              />
              <span className="text-xs text-muted-foreground">
                {isConnected ? "Connected" : "Reconnecting..."}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all rounded-md bg-[#0a0a0a] p-4">
              {progress?.progress_message ?? scan?.progress_message ?? "Waiting for scanner to start..."}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Cancel button */}
      {phase !== "completed" && phase !== "failed" && phase !== "interrupted" && rawStatus !== "cancelled" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (id) cancelScan.mutate(id);
            }}
            disabled={cancelScan.isPending || cancelScan.isSuccess}
          >
            <XCircle className="h-4 w-4" />
            {cancelScan.isPending || cancelScan.isSuccess ? "Cancelling..." : "Cancel Scan"}
          </Button>
        </div>
      )}
      {/* Resume banner for cancelled/interrupted/failed */}
      {(rawStatus === "cancelled" || rawStatus === "interrupted" || rawStatus === "failed") && (
        <div className={cn(
          "rounded-md p-4 text-center space-y-3 border",
          rawStatus === "interrupted" ? "border-amber-500/50 bg-amber-500/10" :
          rawStatus === "failed" ? "border-destructive/50 bg-destructive/10" :
          "border-border bg-muted/50"
        )}>
          <p className={cn("text-sm",
            rawStatus === "interrupted" ? "text-amber-400" :
            rawStatus === "failed" ? "text-destructive" :
            "text-muted-foreground"
          )}>
            {rawStatus === "interrupted" && "This scan was interrupted. Progress has been saved."}
            {rawStatus === "cancelled" && "This scan was cancelled."}
            {rawStatus === "failed" && `Scan failed${scan?.error_message ? `: ${scan.error_message.slice(0, 100)}` : "."}`}
          </p>
          <Button
            onClick={() => {
              if (id) {
                resumeScan.mutate(id, {
                  onSuccess: () => {
                    toast.success("Scan resumed");
                    reconnect(); // Force WebSocket reconnect to pick up new status
                  },
                  onError: () => toast.error("Failed to resume scan"),
                });
              }
            }}
            disabled={resumeScan.isPending}
          >
            <RotateCcw className="h-4 w-4" />
            {resumeScan.isPending ? "Resuming..." : "Resume Scan"}
          </Button>
        </div>
      )}
    </div>
  );
}
