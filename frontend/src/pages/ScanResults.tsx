import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Files,
  FolderSync,
  HardDrive,
  BarChart3,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { useScan, useScanStats, useDeleteScan } from "@/api/scans";
import { useDuplicateDirs, useDuplicateFiles } from "@/api/results";
import type { DuplicateDirectory } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatsCards } from "@/components/results/StatsCards";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const statusBadgeVariant: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "warning",
  running: "secondary",
  pending: "secondary",
};

export function ScanResults() {
  const { id } = useParams<{ id: string }>();
  const { data: scan, isLoading: scanLoading } = useScan(id);
  const { data: stats } = useScanStats(id);
  const { data: dupDirsData } = useDuplicateDirs(id);
  const [filesPage, setFilesPage] = useState(1);
  const { data: dupFilesData } = useDuplicateFiles(id, filesPage);
  const deleteScan = useDeleteScan();
  const [showDelete, setShowDelete] = useState(false);

  if (scanLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading scan results...
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">Scan not found</p>
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
          <Button asChild variant="outline">
            <Link to={`/scans/${id}/similar`}>
              <FolderSync className="h-4 w-4" />
              Similar Directories
            </Link>
          </Button>
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

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="duplicates">Exact Duplicates</TabsTrigger>
          <TabsTrigger value="similar">Similar Directories</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="space-y-6">
            {stats && <StatsCards stats={stats} />}

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

        {/* Exact Duplicates */}
        <TabsContent value="duplicates">
          {dupDirsData?.items && dupDirsData.items.length > 0 ? (
            <div className="space-y-4">
              {Object.entries(
                dupDirsData.items.reduce<Record<string, DuplicateDirectory[]>>(
                  (groups, dir) => {
                    (groups[dir.group_id] ??= []).push(dir);
                    return groups;
                  },
                  {}
                )
              ).map(([groupId, dirs]) => (
                <Card key={groupId}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">
                        Group {groupId.slice(0, 12)}...
                      </CardTitle>
                      <Badge variant="outline">
                        {formatBytes(dirs[0].total_size)} x {dirs.length} dirs
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {dirs.map((dir) => (
                        <div
                          key={dir.path}
                          className="flex items-center justify-between rounded px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <span className="font-mono text-xs truncate max-w-[70%]">
                            {dir.path}
                          </span>
                          <div className="flex items-center gap-2">
                            {dir.is_original && (
                              <Badge variant="success" className="text-xs">
                                original
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {dir.file_count} files · {formatBytes(dir.total_size)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Files className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  No exact duplicate directories found
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Similar Directories (link) */}
        <TabsContent value="similar">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderSync className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-4">
                View directory similarity analysis with advanced filtering
              </p>
              <Button asChild>
                <Link to={`/scans/${id}/similar`}>
                  <BarChart3 className="h-4 w-4" />
                  Open Similar Directories
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Files */}
        <TabsContent value="files">
          {dupFilesData?.items && dupFilesData.items.length > 0 ? (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Path</TableHead>
                      <TableHead className="w-24">Size</TableHead>
                      <TableHead className="w-32">Modified</TableHead>
                      <TableHead className="w-20">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dupFilesData.items.map((file, i) => (
                      <TableRow key={`${file.path}-${i}`} className="hover:bg-accent/50">
                        <TableCell className="font-mono text-xs truncate max-w-md">
                          {file.path}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatBytes(file.size)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {file.mtime
                            ? formatDate(new Date(file.mtime * 1000).toISOString())
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {file.is_original ? (
                            <Badge variant="success" className="text-xs">
                              original
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              duplicate
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {dupFilesData.pages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <span className="text-sm text-muted-foreground">
                      Page {dupFilesData.page} of {dupFilesData.pages} (
                      {formatNumber(dupFilesData.total)} files)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={filesPage <= 1}
                        onClick={() => setFilesPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={filesPage >= dupFilesData.pages}
                        onClick={() => setFilesPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Files className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  No duplicate files found
                </p>
              </CardContent>
            </Card>
          )}
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
