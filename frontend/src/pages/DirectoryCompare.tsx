import { useState, useMemo } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  ChevronLeft,
  Play,
  Bookmark,
  SkipForward,
  FolderTree,
  Files,
  FileText,
  AlertTriangle,
  Layers,
  Loader2,
} from "lucide-react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { Tree, NodeRendererProps } from "react-arborist";
import { useCompare, useTreeDiff } from "@/api/results";
import { useCreateAction, useDryRun } from "@/api/actions";
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
import { formatBytes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TreeDiffNode } from "@/api/types";

// Transform TreeDiffNode[] into react-arborist data format
interface ArboristNode {
  id: string;
  name: string;
  isDir: boolean;
  status: "both" | "only_a" | "only_b";
  match?: "size_match" | "name_only";
  sizeA?: number;
  sizeB?: number;
  similarity?: number;
  collapsed?: boolean;
  childCount?: number;
  children?: ArboristNode[];
}

function transformNodes(nodes: TreeDiffNode[], prefix = ""): ArboristNode[] {
  return nodes.map((node, i) => {
    const id = `${prefix}${node.name}-${i}`;
    return {
      id,
      name: node.name,
      isDir: node.is_dir,
      status: node.status,
      match: node.match,
      sizeA: node.size_a,
      sizeB: node.size_b,
      similarity: node.similarity,
      collapsed: node.collapsed,
      childCount: node.child_count,
      // If collapsed by default, don't pass children so the tree node starts closed
      children: node.children
        ? node.collapsed
          ? transformNodes(node.children, `${id}/`)
          : transformNodes(node.children, `${id}/`)
        : undefined,
    };
  });
}

// Custom node renderer for the tree
function TreeNode({ node, style }: NodeRendererProps<ArboristNode>) {
  const data = node.data;

  const statusBg = {
    both: "",
    only_a: "bg-orange-500/10",
    only_b: "bg-blue-500/10",
  };

  const statusText = {
    both: "text-foreground",
    only_a: "text-orange-400 font-medium",
    only_b: "text-blue-400 font-medium",
  };

  return (
    <div
      style={style}
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-muted/50 rounded text-sm",
        statusBg[data.status]
      )}
      onClick={() => node.isInternal && node.toggle()}
    >
      {data.isDir ? (
        <FolderTree className={cn("h-3.5 w-3.5 shrink-0", statusText[data.status])} />
      ) : (
        <FileText className={cn("h-3.5 w-3.5 shrink-0", statusText[data.status])} />
      )}

      <span className={cn("flex-1 truncate text-xs", statusText[data.status])}>
        {data.name}
        {data.collapsed && data.childCount && (
          <span className="text-[9px] text-muted-foreground ml-1">
            ({data.childCount} items)
          </span>
        )}
      </span>

      {/* Size */}
      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {data.sizeA != null ? formatBytes(data.sizeA) : ""}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {data.sizeB != null ? formatBytes(data.sizeB) : ""}
      </span>

      {/* Status badge */}
      <span className="w-14 text-right shrink-0">
        {data.status === "both" && data.match === "size_match" && (
          <Badge variant="success" className="text-[9px] px-1 py-0">Match</Badge>
        )}
        {data.status === "both" && data.match === "name_only" && (
          <Badge variant="warning" className="text-[9px] px-1 py-0">Differ</Badge>
        )}
        {data.status === "only_a" && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 text-orange-400 border-orange-400/30">A only</Badge>
        )}
        {data.status === "only_b" && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 text-blue-400 border-blue-400/30">B only</Badge>
        )}
      </span>
    </div>
  );
}

export function DirectoryCompare() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dirA = searchParams.get("a");
  const dirB = searchParams.get("b");
  const { data: compare, isLoading: compareLoading } = useCompare(id, dirA, dirB);
  const { data: treeDiff } = useTreeDiff(dirA, dirB);
  const createAction = useCreateAction();
  const dryRun = useDryRun();
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [dryRunOutput, setDryRunOutput] = useState<string>("");

  // Transform tree data for react-arborist
  const treeData = useMemo(() => {
    if (!treeDiff?.tree) return [];
    return transformNodes(treeDiff.tree);
  }, [treeDiff]);

  if (!dirA || !dirB) {
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

  const uniqueACount = compare?.only_in_a.length ?? 0;
  const uniqueBCount = compare?.only_in_b.length ?? 0;
  const uniqueASize = compare?.only_a_size ?? 0;
  const uniqueBSize = compare?.only_b_size ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Directory Compare
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Side-by-side comparison with duplicate highlighting
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Shared</p>
            {compareLoading ? (
              <div className="h-7 w-16 bg-muted animate-pulse rounded mt-1" />
            ) : (
              <p className="text-xl font-bold">{formatNumber(compare?.shared_files.length ?? 0)}</p>
            )}
            <p className="text-xs text-muted-foreground">{compareLoading ? "" : formatBytes(compare?.shared_size ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className={cn("border-l-4 border-l-orange-500", uniqueACount > 0 && "ring-1 ring-orange-500/30")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Only in A</p>
            {compareLoading ? (
              <div className="h-7 w-16 bg-muted animate-pulse rounded mt-1" />
            ) : (
              <p className="text-xl font-bold text-orange-400">{formatNumber(uniqueACount)}</p>
            )}
            <p className="text-xs text-muted-foreground">{compareLoading ? "" : formatBytes(uniqueASize)}</p>
          </CardContent>
        </Card>
        <Card className={cn("border-l-4 border-l-blue-500", uniqueBCount > 0 && "ring-1 ring-blue-500/30")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Only in B</p>
            {compareLoading ? (
              <div className="h-7 w-16 bg-muted animate-pulse rounded mt-1" />
            ) : (
              <p className="text-xl font-bold text-blue-400">{formatNumber(uniqueBCount)}</p>
            )}
            <p className="text-xs text-muted-foreground">{compareLoading ? "" : formatBytes(uniqueBSize)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Warning for unique files */}
      {!compareLoading && (uniqueACount > 0 || uniqueBCount > 0) && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Unique files detected</p>
            <p className="text-xs text-muted-foreground mt-1">
              {uniqueACount > 0 && `Directory A has ${uniqueACount} unique file${uniqueACount > 1 ? "s" : ""} (${formatBytes(uniqueASize)}). `}
              {uniqueBCount > 0 && `Directory B has ${uniqueBCount} unique file${uniqueBCount > 1 ? "s" : ""} (${formatBytes(uniqueBSize)}). `}
              Consider merging unique files before deleting a duplicate directory to avoid data loss.
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Button onClick={() => handleMerge("a_to_b")} disabled={createAction.isPending}>
          <ArrowRight className="h-4 w-4" /> Merge A → B
        </Button>
        <Button onClick={() => handleMerge("b_to_a")} disabled={createAction.isPending}>
          <ArrowLeft className="h-4 w-4" /> Merge B → A
        </Button>
        <Button variant="outline" onClick={handleDryRun} disabled={dryRun.isPending || createAction.isPending}>
          <Play className="h-4 w-4" /> {dryRun.isPending ? "Running..." : "Dry Run"}
        </Button>
        {id && (
          <Button variant="outline" asChild>
            <Link to={`/scans/${id}/assimilate?a=${encodeURIComponent(dirA)}&b=${encodeURIComponent(dirB)}`}>
              <Layers className="h-4 w-4" /> Assimilate
            </Link>
          </Button>
        )}
        <Button
          variant="outline"
          onClick={async () => {
            if (!id || !dirA) return;
            await createAction.mutateAsync({
              scan_id: Number(id),
              action_type: "bookmark",
              source_path: dirA,
              dest_path: dirB ?? undefined,
              notes: "Bookmarked from compare view",
            });
          }}
          disabled={createAction.isPending}
        >
          <Bookmark className="h-4 w-4" /> Bookmark
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (!id || !dirA) return;
            await createAction.mutateAsync({
              scan_id: Number(id),
              action_type: "skip",
              source_path: dirA,
              dest_path: dirB ?? undefined,
              notes: "Skipped from compare view",
            });
          }}
          disabled={createAction.isPending}
        >
          <SkipForward className="h-4 w-4" /> Skip
        </Button>
      </div>

      {createAction.isError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive text-center">
          Failed to create action. Please try again.
        </div>
      )}
      {createAction.isSuccess && !showDryRunModal && (
        <div className="rounded-md border border-success/50 bg-success/10 p-4 text-sm text-success text-center">
          Action created. View it in the Actions Log.
        </div>
      )}

      {/* Dual-pane tree comparison */}
      <Card>
        <CardHeader className="pb-2">
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
          {/* Column headers */}
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground border-b border-border pb-1 px-2">
            <span className="w-4" />
            <span className="flex-1">Name</span>
            <span className="w-16 text-right">Size (A)</span>
            <span className="w-16 text-right">Size (B)</span>
            <span className="w-14 text-right">Status</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <PanelGroup orientation="horizontal" className="min-h-[500px]">
            {/* Directory paths header */}
            <Panel defaultSize={50} minSize={30}>
              <div className="px-3 py-2 border-b border-border">
                <div className="font-mono text-xs text-orange-400 truncate">{dirA}</div>
              </div>
              <ScrollArea className="h-[500px]">
                {treeData.length > 0 ? (
                  <Tree
                    data={treeData}
                    openByDefault={false}
                    width="100%"
                    height={500}
                    indent={20}
                    rowHeight={28}
                    overscanCount={10}
                  >
                    {TreeNode}
                  </Tree>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Loading directory tree...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Scanning filesystem — comparison data is shown above
                    </p>
                  </div>
                )}
              </ScrollArea>
            </Panel>

            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

            <Panel defaultSize={50} minSize={30}>
              <div className="px-3 py-2 border-b border-border">
                <div className="font-mono text-xs text-blue-400 truncate">{dirB}</div>
              </div>
              <div className="h-[500px] flex items-center justify-center text-xs text-muted-foreground">
                <p>Tree shows unified diff. Drag the resize handle to adjust.</p>
              </div>
            </Panel>
          </PanelGroup>
        </CardContent>
      </Card>

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

      {/* Dry run modal */}
      <Dialog open={showDryRunModal} onOpenChange={setShowDryRunModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dry Run Output</DialogTitle>
            <DialogDescription>rsync dry-run showing what would be changed</DialogDescription>
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
