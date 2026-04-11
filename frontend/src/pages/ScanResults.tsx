import { useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Trash2,
  BookmarkPlus,
  BookmarkCheck,
  Layers,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { useScan, useScanStats, useDeleteScan, useSaveFromScan, useResumeScan } from "@/api/scans";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatsCards } from "@/components/results/StatsCards";
import { SpaceChart } from "@/components/results/SpaceChart";
import { DuplicateGroupsList } from "@/components/results/DuplicateGroupsList";
import { SimilarDirectoriesTab } from "@/components/results/SimilarDirectoriesTab";
import { formatDate } from "@/lib/format";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const statusBadgeVariant: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "warning",
  running: "secondary",
  pending: "secondary",
  interrupted: "warning",
};

export function ScanResults() {
  const { id } = useParams<{ id: string }>();
  const { data: scan, isLoading: scanLoading, isError: scanError } = useScan(id);
  const scanExists = !!scan;
  const { data: stats } = useScanStats(scanExists ? id : undefined);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "overview";
  const deleteScan = useDeleteScan();
  const saveFromScan = useSaveFromScan();
  const resumeScan = useResumeScan();
  const [showDelete, setShowDelete] = useState(false);

  if (scanLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading scan results...
      </div>
    );
  }

  if (!scan || scanError) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">
          {scanError ? "This scan no longer exists or could not be loaded." : "Scan not found"}
        </p>
        <Button asChild variant="outline">
          <Link to="/">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{scan.name}</h1>
            <Badge variant={statusBadgeVariant[scan.status] ?? "secondary"}>
              {scan.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Scanned {formatDate(scan.created_at)} using {scan.scanner}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(scan.status === "interrupted" || scan.status === "failed" || scan.status === "cancelled") && (
            <Button
              onClick={() => {
                if (id) {
                  resumeScan.mutate(id);
                  navigate(`/scans/${id}/progress`);
                }
              }}
              disabled={resumeScan.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              {resumeScan.isPending ? "Resuming..." : "Resume Scan"}
            </Button>
          )}
          {scan.status === "completed" && !scan.saved_scan_id && (
            <Button
              variant="outline"
              onClick={() => saveFromScan.mutate(scan.id)}
              disabled={saveFromScan.isPending}
            >
              <BookmarkPlus className="h-4 w-4" />
              Save Scan
            </Button>
          )}
          {scan.saved_scan_id && (
            <Badge variant="secondary" className="gap-1 py-1.5 px-3">
              <BookmarkCheck className="h-3.5 w-3.5" />
              Saved
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Interrupted/failed banner */}
      {scan.status === "interrupted" && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-400">Scan interrupted</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scan.error_message ?? "This scan was interrupted by a restart."}
              {scan.total_files != null && ` Progress: ${scan.total_files.toLocaleString()} files scanned.`}
            </p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="groups">
            <Layers className="h-4 w-4 mr-1" />
            Duplicate Groups
          </TabsTrigger>
          <TabsTrigger value="similar">Similar Directories</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="space-y-6">
            {stats && <StatsCards stats={stats} />}

            {stats && (
              <SpaceChart
                totalSize={stats.scan_total_size ?? 0}
                recoverable={stats.space_recoverable}
              />
            )}

            {/* Scan details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scan Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scanner</dt>
                    <dd className="font-medium capitalize mt-1">{scan.scanner}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</dt>
                    <dd className="mt-1">
                      <Badge variant={statusBadgeVariant[scan.status] ?? "secondary"}>{scan.status}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paths</dt>
                    <dd className="font-medium mt-1">{scan.target_paths.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</dt>
                    <dd className="font-medium mt-1">
                      {formatDate(scan.created_at)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Scanned Paths
                  </dt>
                  <div className="space-y-1">
                    {scan.target_paths.map((p) => (
                      <div
                        key={p}
                        className="rounded bg-muted px-3 py-1.5 font-mono text-xs"
                      >
                        {p}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Duplicate Groups (Czkawka-style) */}
        <TabsContent value="groups">
          {id && <DuplicateGroupsList scanId={id} />}
        </TabsContent>

        {/* Similar Directories */}
        <TabsContent value="similar">
          {id && <SimilarDirectoriesTab scanId={id} />}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Delete Scan"
        description="Are you sure you want to delete this scan? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (id) deleteScan.mutate(id);
        }}
      />
    </div>
  );
}
