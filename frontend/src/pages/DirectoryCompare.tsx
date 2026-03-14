import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  FileText,
  Play,
  Bookmark,
  SkipForward,
  FolderTree,
  Files,
  Trash2,
  Copy,
  Link,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useCompare, useTreeDiff, useFileOperations } from "@/api/results";
import { useCreateAction, useDryRun } from "@/api/actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { Separator } from "@/components/ui/separator";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CompareFile, TreeDiffNode } from "@/api/types";

function FileRow({
  file,
  variant,
}: {
  file: CompareFile;
  variant: "shared" | "unique";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2 rounded text-sm",
        variant === "shared"
          ? "bg-success/5 border border-success/20"
          : "bg-destructive/5 border border-destructive/20"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileText
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            variant === "shared" ? "text-success" : "text-destructive"
          )}
        />
        <span className="font-mono text-xs truncate">{file.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className="text-xs text-muted-foreground">
          {formatBytes(file.size)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDate(file.mtime)}
        </span>
        {variant === "shared" ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <X className="h-3.5 w-3.5 text-destructive" />
        )}
      </div>
    </div>
  );
}

function TreeDiffNodeRow({
  node,
  depth = 0,
  dirA,
  dirB,
  selectedFiles,
  onToggleSelect,
}: {
  node: TreeDiffNode;
  depth?: number;
  dirA: string;
  dirB: string;
  selectedFiles: Set<string>;
  onToggleSelect: (path: string, side: "a" | "b") => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const statusColors = {
    both: "text-foreground",
    only_a: "text-orange-400",
    only_b: "text-blue-400",
  };

  const bgColors = {
    both: "",
    only_a: "bg-orange-500/5",
    only_b: "bg-blue-500/5",
  };

  const fullPathA = `${dirA}/${node.name}`;
  const fullPathB = `${dirB}/${node.name}`;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 hover:bg-muted/50 rounded text-sm",
          bgColors[node.status]
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-muted rounded"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {node.is_dir ? (
          <FolderTree className={cn("h-3.5 w-3.5", statusColors[node.status])} />
        ) : (
          <FileText className={cn("h-3.5 w-3.5", statusColors[node.status])} />
        )}

        <span className={cn("font-mono text-xs flex-1", statusColors[node.status])}>
          {node.name}
        </span>

        {/* Size columns */}
        <span className="text-xs text-muted-foreground w-20 text-right">
          {node.size_a != null ? formatBytes(node.size_a) : "—"}
        </span>
        <span className="text-xs text-muted-foreground w-20 text-right">
          {node.size_b != null ? formatBytes(node.size_b) : "—"}
        </span>

        {/* Similarity badge for dirs */}
        {node.similarity != null && (
          <span className="text-xs text-muted-foreground w-14 text-right">
            {node.similarity}%
          </span>
        )}

        {/* Match indicator */}
        <span className="w-16 text-right">
          {node.status === "both" && node.match === "size_match" && (
            <Badge variant="success" className="text-[10px] px-1">Match</Badge>
          )}
          {node.status === "both" && node.match === "name_only" && (
            <Badge variant="warning" className="text-[10px] px-1">Differ</Badge>
          )}
          {node.status === "only_a" && (
            <Badge variant="outline" className="text-[10px] px-1 text-orange-400">A only</Badge>
          )}
          {node.status === "only_b" && (
            <Badge variant="outline" className="text-[10px] px-1 text-blue-400">B only</Badge>
          )}
        </span>

        {/* File operation buttons */}
        {node.status === "only_a" && !node.is_dir && (
          <div className="flex gap-1">
            <button
              onClick={() => onToggleSelect(fullPathA, "a")}
              className={cn(
                "p-0.5 rounded hover:bg-muted",
                selectedFiles.has(fullPathA) && "bg-primary/20 text-primary"
              )}
              title="Select for operation"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        )}
        {node.status === "only_b" && !node.is_dir && (
          <div className="flex gap-1">
            <button
              onClick={() => onToggleSelect(fullPathB, "b")}
              className={cn(
                "p-0.5 rounded hover:bg-muted",
                selectedFiles.has(fullPathB) && "bg-primary/20 text-primary"
              )}
              title="Select for operation"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {expanded &&
        hasChildren &&
        node.children!.map((child, i) => (
          <TreeDiffNodeRow
            key={`${child.name}-${i}`}
            node={child}
            depth={depth + 1}
            dirA={dirA}
            dirB={dirB}
            selectedFiles={selectedFiles}
            onToggleSelect={onToggleSelect}
          />
        ))}
    </>
  );
}

function FileManagementPanel({
  selectedFiles,
  dirA,
  dirB,
  onClear,
}: {
  selectedFiles: Map<string, "a" | "b">;
  dirA: string;
  dirB: string;
  onClear: () => void;
}) {
  const fileOps = useFileOperations();
  const [lastResults, setLastResults] = useState<string>("");

  if (selectedFiles.size === 0) return null;

  const handleOperation = async (op: "copy" | "move" | "delete" | "hardlink") => {
    const operations = Array.from(selectedFiles.entries()).map(([path, side]) => {
      const dest =
        op === "delete"
          ? undefined
          : side === "a"
          ? path.replace(dirA, dirB)
          : path.replace(dirB, dirA);
      return { operation: op, source_path: path, dest_path: dest };
    });

    // Always dry-run first
    const result = await fileOps.mutateAsync({ operations, dry_run: true });
    setLastResults(
      result.results
        .map((r) => `${r.status}: ${r.message || r.operation}`)
        .join("\n")
    );
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Files className="h-4 w-4" />
          File Operations ({selectedFiles.size} selected)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => handleOperation("copy")}>
            <Copy className="h-3 w-3" /> Copy to other side
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleOperation("move")}>
            <ArrowRight className="h-3 w-3" /> Move to other side
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleOperation("hardlink")}>
            <Link className="h-3 w-3" /> Hardlink
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleOperation("delete")}>
            <Trash2 className="h-3 w-3" /> Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        </div>
        {fileOps.isPending && (
          <p className="text-xs text-muted-foreground">Running dry-run...</p>
        )}
        {lastResults && (
          <pre className="text-xs font-mono bg-muted p-3 rounded max-h-32 overflow-auto">
            {lastResults}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

export function DirectoryCompare() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const dirA = searchParams.get("a");
  const dirB = searchParams.get("b");
  const { data: compare, isLoading } = useCompare(id, dirA, dirB);
  const { data: treeDiff } = useTreeDiff(dirA, dirB);
  const createAction = useCreateAction();
  const dryRun = useDryRun();
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [dryRunOutput, setDryRunOutput] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<Map<string, "a" | "b">>(new Map());

  const toggleSelect = (path: string, side: "a" | "b") => {
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.set(path, side);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading comparison...
      </div>
    );
  }

  if (!compare || !dirA || !dirB) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Unable to load comparison data. Make sure both directories are specified.
      </div>
    );
  }

  const handleMerge = async (direction: "a_to_b" | "b_to_a") => {
    if (!id) return;
    const source = direction === "a_to_b" ? dirA : dirB;
    const dest = direction === "a_to_b" ? dirB : dirA;
    await createAction.mutateAsync({
      scan_id: Number(id),
      action_type: "merge",
      source_path: source!,
      dest_path: dest!,
    });
  };

  const handleDryRun = async () => {
    if (!id) return;
    try {
      const action = await createAction.mutateAsync({
        scan_id: Number(id),
        action_type: "merge",
        source_path: dirA!,
        dest_path: dirB!,
        notes: "Dry run from compare view",
      });
      const result = await dryRun.mutateAsync(String(action.id));
      setDryRunOutput(result.dry_run_output ?? "No output available");
      setShowDryRunModal(true);
    } catch {
      // Error handled by mutation state
    }
  };

  const allFilesA = [
    ...compare.shared_files.map((f) => ({ ...f, type: "shared" as const })),
    ...compare.only_in_a.map((f) => ({ ...f, type: "unique" as const })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const allFilesB = [
    ...compare.shared_files.map((f) => ({ ...f, type: "shared" as const })),
    ...compare.only_in_b.map((f) => ({ ...f, type: "unique" as const })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Directory Compare
        </h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side comparison of directory contents
        </p>
      </div>

      {/* Summary bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-success">
                {formatNumber(compare.shared_files.length)}
              </div>
              <div className="text-sm text-muted-foreground">
                Shared files ({formatBytes(compare.shared_size)})
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-destructive">
                {formatNumber(compare.only_in_a.length)}
              </div>
              <div className="text-sm text-muted-foreground">
                Only in A ({formatBytes(compare.only_a_size)})
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-destructive">
                {formatNumber(compare.only_in_b.length)}
              </div>
              <div className="text-sm text-muted-foreground">
                Only in B ({formatBytes(compare.only_b_size)})
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Button
          onClick={() => handleMerge("a_to_b")}
          disabled={createAction.isPending}
        >
          <ArrowRight className="h-4 w-4" />
          Merge A into B
        </Button>
        <Button
          onClick={() => handleMerge("b_to_a")}
          disabled={createAction.isPending}
        >
          <ArrowLeft className="h-4 w-4" />
          Merge B into A
        </Button>
        <Button
          variant="outline"
          onClick={handleDryRun}
          disabled={dryRun.isPending || createAction.isPending}
        >
          <Play className="h-4 w-4" />
          {dryRun.isPending ? "Running..." : "Dry Run (rsync)"}
        </Button>
        <Button variant="outline">
          <Bookmark className="h-4 w-4" />
          Bookmark
        </Button>
        <Button variant="ghost">
          <SkipForward className="h-4 w-4" />
          Skip
        </Button>
      </div>

      {createAction.isError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive text-center">
          Failed to create action. Please try again.
        </div>
      )}

      {createAction.isSuccess && !showDryRunModal && (
        <div className="rounded-md border border-success/50 bg-success/10 p-4 text-sm text-success text-center">
          Action created successfully. View it in the Actions Log.
        </div>
      )}

      {/* File management panel */}
      <FileManagementPanel
        selectedFiles={selectedFiles}
        dirA={dirA}
        dirB={dirB}
        onClear={() => setSelectedFiles(new Map())}
      />

      {/* Tabbed comparison views */}
      <Tabs defaultValue="files" className="space-y-4">
        <TabsList>
          <TabsTrigger value="files">
            <Files className="h-4 w-4 mr-1" /> File Comparison
          </TabsTrigger>
          <TabsTrigger value="tree">
            <FolderTree className="h-4 w-4 mr-1" /> Tree Diff
          </TabsTrigger>
        </TabsList>

        {/* File list view (original two-column) */}
        <TabsContent value="files">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Directory A</CardTitle>
                  <Badge variant="outline">
                    {formatNumber(allFilesA.length)} files
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground break-all">
                  {compare.dir_a}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1 pr-4">
                    {allFilesA.map((file, i) => (
                      <FileRow
                        key={`a-${file.name}-${i}`}
                        file={file}
                        variant={file.type}
                      />
                    ))}
                    {allFilesA.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No files
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Directory B</CardTitle>
                  <Badge variant="outline">
                    {formatNumber(allFilesB.length)} files
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground break-all">
                  {compare.dir_b}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1 pr-4">
                    {allFilesB.map((file, i) => (
                      <FileRow
                        key={`b-${file.name}-${i}`}
                        file={file}
                        variant={file.type}
                      />
                    ))}
                    {allFilesB.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No files
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tree diff view */}
        <TabsContent value="tree">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Directory Tree Comparison</CardTitle>
                {treeDiff?.stats && (
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="text-foreground">{treeDiff.stats.both} shared</span>
                    <span className="text-orange-400">{treeDiff.stats.only_a} only in A</span>
                    <span className="text-blue-400">{treeDiff.stats.only_b} only in B</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="font-mono text-xs text-muted-foreground break-all">
                  <span className="text-orange-400 font-semibold">A:</span> {dirA}
                </div>
                <div className="font-mono text-xs text-muted-foreground break-all">
                  <span className="text-blue-400 font-semibold">B:</span> {dirB}
                </div>
              </div>
              {/* Column headers */}
              <div className="flex items-center gap-1 py-1 px-2 mt-2 text-xs text-muted-foreground border-b border-border">
                <span className="w-4" />
                <span className="w-4" />
                <span className="flex-1">Name</span>
                <span className="w-20 text-right">Size (A)</span>
                <span className="w-20 text-right">Size (B)</span>
                <span className="w-14 text-right">Sim %</span>
                <span className="w-16 text-right">Status</span>
                <span className="w-6" />
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                {treeDiff?.tree ? (
                  treeDiff.tree.map((node, i) => (
                    <TreeDiffNodeRow
                      key={`${node.name}-${i}`}
                      node={node}
                      dirA={dirA!}
                      dirB={dirB!}
                      selectedFiles={new Set(selectedFiles.keys())}
                      onToggleSelect={toggleSelect}
                    />
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Loading tree diff...
                  </p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-success/20 border border-success/30" />
          <span>Shared (matching checksum)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-orange-500/20 border border-orange-500/30" />
          <span>Only in A</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-blue-500/20 border border-blue-500/30" />
          <span>Only in B</span>
        </div>
      </div>

      {/* Dry run output modal */}
      <Dialog open={showDryRunModal} onOpenChange={setShowDryRunModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dry Run Output</DialogTitle>
            <DialogDescription>
              rsync dry-run showing what would be changed
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <pre className="rounded-md bg-muted p-4 text-xs font-mono whitespace-pre-wrap">
              {dryRunOutput}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
