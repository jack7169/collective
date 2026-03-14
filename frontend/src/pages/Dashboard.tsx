import { Link } from "react-router-dom";
import {
  ScanSearch,
  FolderSync,
  HardDrive,
  Activity,
  Plus,
  ArrowRight,
  Clock,
} from "lucide-react";
import { useScans } from "@/api/scans";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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

export function Dashboard() {
  const { data: scansData, isLoading } = useScans();
  const scans = scansData?.items ?? [];

  const totalScans = scansData?.total ?? 0;
  const activeScans = scans.filter((s) => s.status === "running").length;
  const completedScans = scans.filter((s) => s.status === "completed");
  const totalDuplicates = completedScans.reduce(
    (sum, s) => sum + (s.duplicates_found ?? 0),
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
      color: "text-primary",
    },
    {
      label: "Duplicates Found",
      value: formatNumber(totalDuplicates),
      icon: FolderSync,
      color: "text-orange-400",
    },
    {
      label: "Space Recoverable",
      value: formatBytes(totalRecoverable),
      icon: HardDrive,
      color: "text-success",
    },
    {
      label: "Active Scans",
      value: formatNumber(activeScans),
      icon: Activity,
      color: "text-warning",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your duplicate detection scans
          </p>
        </div>
        <Button asChild size="lg">
          <Link to="/scans/new">
            <Plus className="h-5 w-5" />
            New Scan
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardDescription className="text-sm font-medium">
                  {stat.label}
                </CardDescription>
                <Icon className={`h-5 w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent scans */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Scans</CardTitle>
          <CardDescription>
            Your latest duplicate detection scans
          </CardDescription>
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
            <div className="space-y-3">
              {scans.slice(0, 10).map((scan) => (
                <Link
                  key={scan.id}
                  to={
                    scan.status === "running"
                      ? `/scans/${scan.id}/progress`
                      : `/scans/${scan.id}`
                  }
                  className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="font-medium">{scan.name}</div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDate(scan.created_at)}
                        <span className="text-border">|</span>
                        <span className="capitalize">{scan.scanner}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {scan.duplicates_found != null && (
                      <div className="text-right text-sm text-muted-foreground hidden sm:block">
                        <div>
                          {formatNumber(scan.duplicates_found)} duplicates
                        </div>
                        <div>{formatBytes(scan.space_recoverable ?? 0)} recoverable</div>
                      </div>
                    )}
                    <Badge variant={statusVariant[scan.status] ?? "secondary"}>
                      {scan.status}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
