import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  XCircle,
  CheckCircle2,
  FileSearch,
  Hash,
  BarChart3,
  Zap,
} from "lucide-react";
import { useScanProgress } from "@/api/websocket";
import { useScan, useCancelScan } from "@/api/scans";
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
import { cn } from "@/lib/utils";

const phaseConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  hashing: { icon: Hash, label: "Hashing Files", color: "text-primary" },
  parsing: { icon: FileSearch, label: "Parsing Results", color: "text-orange-400" },
  analyzing: { icon: BarChart3, label: "Analyzing Similarities", color: "text-purple-400" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-success" },
  failed: { icon: XCircle, label: "Failed", color: "text-destructive" },
};

export function ScanProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { progress, isConnected } = useScanProgress(id);
  const { data: scan } = useScan(id);
  const cancelScan = useCancelScan();

  // Map backend status to display phase
  const rawStatus = progress?.status ?? scan?.status ?? "pending";
  const phase = rawStatus === "running" ? "hashing" : rawStatus;

  // Auto-navigate when completed
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          {scan?.name ?? "Scanning..."}
        </h1>
        <p className="text-muted-foreground mt-1">
          {phase === "completed"
            ? "Scan complete! Redirecting to results..."
            : phase === "failed"
              ? "Scan failed"
              : "Scanning for duplicates and similar directories"}
        </p>
      </div>

      {/* Main progress */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center space-y-6">
            {/* Phase icon */}
            <div
              className={cn(
                "flex h-20 w-20 items-center justify-center rounded-full",
                phase === "completed"
                  ? "bg-success/10"
                  : phase === "failed"
                    ? "bg-destructive/10"
                    : "bg-primary/10"
              )}
            >
              {phase !== "completed" && phase !== "failed" ? (
                <Loader2
                  className={cn("h-10 w-10 animate-spin", phaseInfo.color)}
                />
              ) : (
                <PhaseIcon className={cn("h-10 w-10", phaseInfo.color)} />
              )}
            </div>

            {/* Phase badge */}
            <Badge
              variant="outline"
              className={cn("text-sm", phaseInfo.color)}
            >
              <PhaseIcon className="mr-1.5 h-3.5 w-3.5" />
              {phaseInfo.label}
            </Badge>

            {/* Progress bar */}
            <div className="w-full space-y-2">
              <Progress value={percent} className="h-3" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{percent.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Files Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {formatNumber(progress?.total_files ?? scan?.total_files ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Duplicates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {formatNumber(progress?.duplicates_found ?? scan?.duplicates_found ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5 text-xl font-bold capitalize">
              <Zap className="h-4 w-4 text-warning" />
              {rawStatus}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Progress</CardTitle>
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
          <ScrollArea className="h-40">
            <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
              {progress?.progress_message ?? scan?.progress_message ?? "Waiting for scanner to start..."}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Cancel button */}
      {phase !== "completed" && phase !== "failed" && (
        <div className="flex justify-center">
          <Button
            variant="destructive"
            onClick={() => {
              if (id) cancelScan.mutate(id);
            }}
            disabled={cancelScan.isPending}
          >
            <XCircle className="h-4 w-4" />
            {cancelScan.isPending ? "Cancelling..." : "Cancel Scan"}
          </Button>
        </div>
      )}
    </div>
  );
}
