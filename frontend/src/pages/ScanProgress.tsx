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
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string; chipColor: string }
> = {
  hashing: { icon: Hash, label: "Hashing Files", color: "text-primary", chipColor: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  parsing: { icon: FileSearch, label: "Parsing Results", color: "text-amber-400", chipColor: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  analyzing: { icon: BarChart3, label: "Analyzing Similarities", color: "text-cyan-400", chipColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-success", chipColor: "bg-green-500/10 text-green-400 border-green-500/20" },
  failed: { icon: XCircle, label: "Failed", color: "text-destructive", chipColor: "bg-red-500/10 text-red-400 border-red-500/20" },
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

  const metricCards = [
    {
      label: "Files",
      value: formatNumber(progress?.total_files ?? scan?.total_files ?? 0),
      icon: Files,
      borderColor: "border-l-blue-500",
      iconColor: "text-blue-500",
    },
    {
      label: "Directories",
      value: formatNumber(progress?.total_dirs ?? scan?.total_dirs ?? 0),
      icon: FolderOpen,
      borderColor: "border-l-green-500",
      iconColor: "text-green-500",
    },
    {
      label: "Total Size",
      value: formatBytes(progress?.total_size ?? scan?.total_size ?? 0),
      icon: HardDrive,
      borderColor: "border-l-amber-500",
      iconColor: "text-amber-500",
    },
    {
      label: "Duplicates",
      value: formatNumber(progress?.duplicates_found ?? scan?.duplicates_found ?? 0),
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
                {phase !== "completed" && phase !== "failed" ? (
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
                percent > 80 ? "[&>div]:bg-red-500" : percent > 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"
              )}
            />
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
      {phase !== "completed" && phase !== "failed" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
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
