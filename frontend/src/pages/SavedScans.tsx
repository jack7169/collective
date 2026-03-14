import { Link } from "react-router-dom";
import {
  BookmarkCheck,
  Play,
  Trash2,
  Clock,
  Plus,
  Loader2,
} from "lucide-react";
import {
  useSavedScans,
  useDeleteSavedScan,
  useRunSavedScan,
} from "@/api/scans";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useState } from "react";

export function SavedScans() {
  const { data: savedScans, isLoading } = useSavedScans();
  const deleteSaved = useDeleteSavedScan();
  const runSaved = useRunSavedScan();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading saved scans...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saved Scans</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Persistent scan configurations with optional scheduling
          </p>
        </div>
        <Button asChild>
          <Link to="/scans/new">
            <Plus className="h-4 w-4" />
            New Scan
          </Link>
        </Button>
      </div>

      {!savedScans || savedScans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookmarkCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-4">
              No saved scans yet. Run a scan first, then save it for easy re-runs.
            </p>
            <Button asChild variant="outline">
              <Link to="/scans/new">Create a Scan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {savedScans.map((saved) => (
            <Card key={saved.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">{saved.name}</CardTitle>
                    <Badge variant="outline" className="capitalize">
                      {saved.scanner}
                    </Badge>
                    {saved.schedule_enabled && (
                      <Badge variant="secondary">
                        <Clock className="h-3 w-3 mr-1" />
                        {saved.schedule_interval}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runSaved.mutate(saved.id)}
                      disabled={runSaved.isPending}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run Now
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(saved.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Paths
                    </span>
                    <p className="font-medium mt-0.5">
                      {saved.target_paths.length}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Total Runs
                    </span>
                    <p className="font-medium mt-0.5">
                      {formatNumber(saved.total_runs)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Last Run
                    </span>
                    <p className="font-medium mt-0.5">
                      {saved.last_run_at ? formatDate(saved.last_run_at) : "Never"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Last Recoverable
                    </span>
                    <p className="font-medium mt-0.5">
                      {saved.last_space_recoverable != null
                        ? formatBytes(saved.last_space_recoverable)
                        : "—"}
                    </p>
                  </div>
                </div>
                {saved.description && (
                  <p className="text-sm text-muted-foreground mt-3">
                    {saved.description}
                  </p>
                )}
                <div className="mt-3 space-y-1">
                  {saved.target_paths.map((p) => (
                    <div
                      key={p}
                      className="rounded bg-muted px-3 py-1.5 font-mono text-xs"
                    >
                      {p}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete Saved Scan"
        description="Are you sure you want to delete this saved scan configuration? This will not delete any completed scan results."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteId !== null) {
            deleteSaved.mutate(deleteId);
            setDeleteId(null);
          }
        }}
      />
    </div>
  );
}
