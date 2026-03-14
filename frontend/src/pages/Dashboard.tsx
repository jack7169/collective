import { Link } from "react-router-dom";
import {
  ScanSearch,
  HardDrive,
  Activity,
  Plus,
  ArrowRight,
  Clock,
  Files,
} from "lucide-react";
import { useScans } from "@/api/scans";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  pending: "secondary",
  running: "warning",
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
};

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-yellow-500",
};

export function Dashboard() {
  const { data: scansData, isLoading } = useScans();
  const scans = scansData?.items ?? [];

  const totalScans = scansData?.total ?? 0;
  const activeScans = scans.filter((s) => s.status === "running").length;
  const completedScans = scans.filter((s) => s.status === "completed");
  const totalFilesScanned = completedScans.reduce(
    (sum, s) => sum + (s.total_files ?? 0),
    0
  );
  const totalRecoverable = completedScans.reduce(
    (sum, s) => sum + (s.space_recoverable ?? 0),
    0
  );

  const statCards = [
    {
      label: "Total Scans",
      value: formatNumber(totalScans),
      icon: ScanSearch,
      borderColor: "border-l-blue-500",
      iconColor: "text-blue-500",
    },
    {
      label: "Files Scanned",
      value: formatNumber(totalFilesScanned),
      icon: Files,
      borderColor: "border-l-green-500",
      iconColor: "text-green-500",
    },
    {
      label: "Space Recoverable",
      value: formatBytes(totalRecoverable),
      icon: HardDrive,
      borderColor: "border-l-amber-500",
      iconColor: "text-amber-500",
    },
    {
      label: "Active Scans",
      value: formatNumber(activeScans),
      icon: Activity,
      borderColor: "border-l-cyan-500",
      iconColor: "text-cyan-500",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of your storage analysis
          </p>
        </div>
        <Button asChild>
          <Link to="/scans/new">
            <Plus className="h-4 w-4" />
            New Scan
          </Link>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className={`border-l-4 ${stat.borderColor}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {stat.label}
                    </p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Scans — 2/3 width */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Scans</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Loading scans...
              </div>
            ) : scans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ScanSearch className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-4">
                  No scans yet. Start your first scan to find duplicates.
                </p>
                <Button asChild>
                  <Link to="/scans/new">
                    <Plus className="h-4 w-4" />
                    Create First Scan
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {scans.slice(0, 8).map((scan) => (
                  <Link
                    key={scan.id}
                    to={
                      scan.status === "running"
                        ? `/scans/${scan.id}/progress`
                        : `/scans/${scan.id}`
                    }
                    className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent/50 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-2 w-2 rounded-full shrink-0 ${statusColors[scan.status] ?? "bg-gray-500"}`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {scan.name}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatDate(scan.created_at)}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {scan.scanner}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={statusVariant[scan.status] ?? "secondary"} className="text-xs">
                        {scan.status}
                      </Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions — 1/3 width */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/scans/new">
                <Plus className="h-4 w-4" />
                New Scan
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/actions">
                <Activity className="h-4 w-4" />
                Actions Log
              </Link>
            </Button>
            {completedScans.length > 0 && (
              <div className="pt-3 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Latest Completed
                </p>
                {completedScans.slice(0, 3).map((scan) => (
                  <Link
                    key={scan.id}
                    to={`/scans/${scan.id}`}
                    className="flex items-center justify-between py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="truncate">{scan.name}</span>
                    <ArrowRight className="h-3 w-3 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
