import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  FolderTree,
  FileText,
  Save,
  Eye,
  Play,
  RotateCcw,
  Trash2,
  Copy,
  ArrowRight,
  Layers,
  AlertTriangle,
  Box,
} from "lucide-react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { Tree, NodeRendererProps } from "react-arborist";
import {
  useAssimilateSession,
  useCreateAssimilateSession,
  useStageOperations,
  usePreviewCommit,
  useAcknowledgeWarnings,
  useCommitSession,
} from "@/api/assimilate";
import { useTreeDiff } from "@/api/results";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommitPreview } from "@/components/assimilate/CommitPreview";
import { DirectoryPointCloud } from "@/components/assimilate/DirectoryPointCloud";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { TreeDiffNode, StagedOperation } from "@/api/types";

// Transform tree for react-arborist
interface ArboristNode {
  id: string;
  name: string;
  isDir: boolean;
  status: "both" | "only_a" | "only_b";
  sizeA?: number;
  sizeB?: number;
  pathA?: string;
  pathB?: string;
  children?: ArboristNode[];
}

function transformTree(
  nodes: TreeDiffNode[],
  dirA: string,
  dirB: string,
  prefix = "",
): ArboristNode[] {
  return nodes.map((node, i) => {
    const id = `${prefix}${node.name}-${i}`;
    return {
      id,
      name: node.name,
      isDir: node.is_dir,
      status: node.status,
      sizeA: node.size_a,
      sizeB: node.size_b,
      pathA: node.status !== "only_b" ? `${dirA}/${node.name}` : undefined,
      pathB: node.status !== "only_a" ? `${dirB}/${node.name}` : undefined,
      children: node.children
        ? transformTree(
            node.children,
            `${dirA}/${node.name}`,
            `${dirB}/${node.name}`,
            `${id}/`,
          )
        : undefined,
    };
  });
}

function TreeNode({ node, style }: NodeRendererProps<ArboristNode>) {
  const d = node.data;
  const bg = { both: "", only_a: "bg-orange-500/15", only_b: "bg-blue-500/15" };
  const txt = { both: "text-foreground", only_a: "text-orange-400 font-medium", only_b: "text-blue-400 font-medium" };

  return (
    <div
      style={style}
      className={cn("flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-muted/50 rounded text-sm", bg[d.status])}
      onClick={() => node.isInternal && node.toggle()}
    >
      {d.isDir ? (
        <FolderTree className={cn("h-3.5 w-3.5 shrink-0", txt[d.status])} />
      ) : (
        <FileText className={cn("h-3.5 w-3.5 shrink-0", txt[d.status])} />
      )}
      <span className={cn("flex-1 truncate text-xs", txt[d.status])}>{d.name}</span>
      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {d.sizeA != null ? formatBytes(d.sizeA) : ""}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {d.sizeB != null ? formatBytes(d.sizeB) : ""}
      </span>
      <span className="w-12 text-right shrink-0">
        {d.status === "only_a" && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 text-orange-400 border-orange-400/30">A</Badge>
        )}
        {d.status === "only_b" && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 text-blue-400 border-blue-400/30">B</Badge>
        )}
      </span>
    </div>
  );
}

export function AssimilateDuplicates() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const dirA = searchParams.get("a");
  const dirB = searchParams.get("b");

  const [sessionId, setSessionId] = useState<number | undefined>();
  const [showPreview, setShowPreview] = useState(false);
  const [localOps, setLocalOps] = useState<StagedOperation[]>([]);
  const [show3D, setShow3D] = useState(false);

  const createSession = useCreateAssimilateSession();
  const { data: session } = useAssimilateSession(sessionId);
  const { data: treeDiff } = useTreeDiff(dirA, dirB);
  const stageOps = useStageOperations(sessionId ?? 0);
  const previewCommit = usePreviewCommit(sessionId ?? 0);
  const acknowledgeWarnings = useAcknowledgeWarnings(sessionId ?? 0);
  const commitSession = useCommitSession(sessionId ?? 0);

  // Auto-create session on mount
  useEffect(() => {
    if (!id || !dirA || !dirB || sessionId) return;
    createSession.mutate(
      { scan_id: Number(id), name: `Assimilate ${dirA.split("/").pop()} ↔ ${dirB.split("/").pop()}`, dir_a: dirA, dir_b: dirB },
      {
        onSuccess: (s) => setSessionId(s.id),
        onError: () => toast.error("Failed to create session"),
      },
    );
  }, [id, dirA, dirB]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync local ops from session
  useEffect(() => {
    if (session?.staged_operations) {
      setLocalOps(session.staged_operations);
    }
  }, [session?.staged_operations]);

  const treeData = useMemo(() => {
    if (!treeDiff?.tree || !dirA || !dirB) return [];
    return transformTree(treeDiff.tree, dirA, dirB);
  }, [treeDiff, dirA, dirB]);

  // Collect all unique files for quick actions
  const uniqueFiles = useMemo(() => {
    const onlyA: ArboristNode[] = [];
    const onlyB: ArboristNode[] = [];
    function walk(nodes: ArboristNode[]) {
      for (const n of nodes) {
        if (!n.isDir && n.status === "only_a") onlyA.push(n);
        if (!n.isDir && n.status === "only_b") onlyB.push(n);
        if (n.children) walk(n.children);
      }
    }
    walk(treeData);
    return { onlyA, onlyB };
  }, [treeData]);

  const addOp = (op: StagedOperation) => {
    const next = [...localOps, op];
    setLocalOps(next);
    if (sessionId) stageOps.mutate(next);
  };

  const removeOp = (index: number) => {
    const next = localOps.filter((_, i) => i !== index);
    setLocalOps(next);
    if (sessionId) stageOps.mutate(next);
  };

  const clearOps = () => {
    setLocalOps([]);
    if (sessionId) stageOps.mutate([]);
  };

  const mergeUniqueToB = () => {
    const ops: StagedOperation[] = uniqueFiles.onlyA.map((f) => ({
      type: "copy" as const,
      source: f.pathA!,
      dest: f.pathA!.replace(dirA!, dirB!),
      description: `Copy ${f.name} → B`,
    }));
    const next = [...localOps, ...ops];
    setLocalOps(next);
    if (sessionId) stageOps.mutate(next);
    toast.success(`Staged ${ops.length} copy operations`);
  };

  const mergeUniqueToA = () => {
    const ops: StagedOperation[] = uniqueFiles.onlyB.map((f) => ({
      type: "copy" as const,
      source: f.pathB!,
      dest: f.pathB!.replace(dirB!, dirA!),
      description: `Copy ${f.name} → A`,
    }));
    const next = [...localOps, ...ops];
    setLocalOps(next);
    if (sessionId) stageOps.mutate(next);
    toast.success(`Staged ${ops.length} copy operations`);
  };

  const handlePreview = async () => {
    if (!sessionId) return;
    try {
      await previewCommit.mutateAsync();
      setShowPreview(true);
    } catch {
      toast.error("Preview failed");
    }
  };

  const handleCommit = async () => {
    if (!sessionId) return;
    try {
      await commitSession.mutateAsync();
      setShowPreview(false);
      toast.success("Changes committed successfully");
    } catch (e) {
      toast.error("Commit failed");
    }
  };

  if (!dirA || !dirB) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Missing directory parameters. Navigate here from Similar Directories.
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold">Assimilate Duplicates</h1>
            <p className="text-xs text-muted-foreground">
              Stage changes, preview, then commit. No disk changes until you commit.
            </p>
          </div>
          {session && (
            <Badge variant={session.status === "committed" ? "success" : "secondary"} className="text-xs">
              {session.status}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShow3D(true)}>
            <Box className="h-3.5 w-3.5" /> 3D View
          </Button>
          <Button variant="outline" size="sm" onClick={clearOps} disabled={localOps.length === 0}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handlePreview} disabled={localOps.length === 0 || previewCommit.isPending}>
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
          <Button size="sm" onClick={handlePreview} disabled={localOps.length === 0}>
            <Play className="h-3.5 w-3.5" /> Commit ({localOps.length})
          </Button>
        </div>
      </div>

      {/* Warning for unique files */}
      {(uniqueFiles.onlyA.length > 0 || uniqueFiles.onlyB.length > 0) && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-amber-400">
              {uniqueFiles.onlyA.length > 0 && `${uniqueFiles.onlyA.length} files only in A. `}
              {uniqueFiles.onlyB.length > 0 && `${uniqueFiles.onlyB.length} files only in B. `}
              Merge before deleting to avoid data loss.
            </span>
          </div>
          <div className="flex gap-2">
            {uniqueFiles.onlyA.length > 0 && (
              <Button size="sm" variant="outline" onClick={mergeUniqueToB}>
                <ArrowRight className="h-3 w-3" /> Merge A→B
              </Button>
            )}
            {uniqueFiles.onlyB.length > 0 && (
              <Button size="sm" variant="outline" onClick={mergeUniqueToA}>
                <ArrowRight className="h-3 w-3 rotate-180" /> Merge B→A
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main resizable layout */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left: Tree navigator */}
        <Panel defaultSize={30} minSize={20}>
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle className="text-xs flex items-center gap-2">
                <FolderTree className="h-3.5 w-3.5" />
                Directory Tree
              </CardTitle>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border-b border-border pb-1">
                <span className="flex-1">Name</span>
                <span className="w-16 text-right">A</span>
                <span className="w-16 text-right">B</span>
                <span className="w-12" />
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0">
              {treeData.length > 0 ? (
                <Tree
                  data={treeData}
                  openByDefault={true}
                  width="100%"
                  height={600}
                  indent={16}
                  rowHeight={26}
                  overscanCount={20}
                >
                  {TreeNode}
                </Tree>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Loading tree...
                </div>
              )}
            </CardContent>
          </Card>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors mx-0.5" />

        {/* Right: Staged operations + info */}
        <Panel defaultSize={70} minSize={40}>
          <PanelGroup orientation="vertical">
            {/* Directory info */}
            <Panel defaultSize={60} minSize={30}>
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2 shrink-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-medium text-orange-400">Directory A</span>
                      <p className="font-mono text-xs text-muted-foreground truncate">{dirA}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-medium text-blue-400">Directory B</span>
                      <p className="font-mono text-xs text-muted-foreground truncate">{dirB}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 overflow-auto">
                  {treeDiff?.stats && (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="text-center p-2 rounded bg-muted">
                        <p className="text-lg font-bold">{treeDiff.stats.both}</p>
                        <p className="text-[10px] text-muted-foreground">Shared</p>
                      </div>
                      <div className="text-center p-2 rounded bg-orange-500/10">
                        <p className="text-lg font-bold text-orange-400">{treeDiff.stats.only_a}</p>
                        <p className="text-[10px] text-muted-foreground">Only in A</p>
                      </div>
                      <div className="text-center p-2 rounded bg-blue-500/10">
                        <p className="text-lg font-bold text-blue-400">{treeDiff.stats.only_b}</p>
                        <p className="text-[10px] text-muted-foreground">Only in B</p>
                      </div>
                    </div>
                  )}

                  {/* Quick actions for unique files */}
                  <div className="space-y-2">
                    {uniqueFiles.onlyA.slice(0, 20).map((f) => (
                      <div key={f.id} className="flex items-center gap-2 text-xs rounded bg-orange-500/5 border border-orange-500/20 px-2 py-1.5">
                        <FileText className="h-3 w-3 text-orange-400 shrink-0" />
                        <span className="font-mono truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">{f.sizeA != null ? formatBytes(f.sizeA) : ""}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5"
                          onClick={() => addOp({ type: "copy", source: f.pathA!, dest: f.pathA!.replace(dirA!, dirB!), description: `Copy ${f.name} → B` })}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    {uniqueFiles.onlyB.slice(0, 20).map((f) => (
                      <div key={f.id} className="flex items-center gap-2 text-xs rounded bg-blue-500/5 border border-blue-500/20 px-2 py-1.5">
                        <FileText className="h-3 w-3 text-blue-400 shrink-0" />
                        <span className="font-mono truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">{f.sizeB != null ? formatBytes(f.sizeB) : ""}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5"
                          onClick={() => addOp({ type: "copy", source: f.pathB!, dest: f.pathB!.replace(dirB!, dirA!), description: `Copy ${f.name} → A` })}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Panel>

            <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 transition-colors my-0.5" />

            {/* Staged operations panel */}
            <Panel defaultSize={40} minSize={20}>
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs">
                      Staged Operations ({localOps.length})
                    </CardTitle>
                    {localOps.length > 0 && (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={clearOps}>
                        Clear all
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 p-0">
                  <ScrollArea className="h-full px-4 pb-4">
                    {localOps.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-8">
                        No operations staged. Use the tree or quick actions above to stage changes.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {localOps.map((op, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs rounded bg-muted/50 px-2 py-1.5">
                            <Badge variant="outline" className="text-[8px] shrink-0">{op.type}</Badge>
                            <span className="font-mono truncate flex-1">{op.description || op.source}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-muted-foreground hover:text-destructive"
                              onClick={() => removeOp(i)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      {/* Fullscreen 3D point cloud */}
      {show3D && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShow3D(false)}>
              Close 3D View
            </Button>
          </div>
          <div className="absolute top-4 left-4 z-10">
            <h2 className="text-lg font-bold text-white">Directory Point Cloud</h2>
            <p className="text-xs text-white/50">
              Orbit: drag · Zoom: scroll · Click: inspect
            </p>
          </div>
          {treeDiff?.tree && dirA && dirB ? (
            <DirectoryPointCloud
              treeData={treeDiff.tree}
              dirA={dirA}
              dirB={dirB}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Loading...
            </div>
          )}
        </div>
      )}

      {/* Commit preview dialog */}
      <CommitPreview
        open={showPreview}
        onOpenChange={setShowPreview}
        preview={session?.preview_result ?? null}
        onAcknowledge={(checksums) => {
          if (sessionId) acknowledgeWarnings.mutate(checksums);
        }}
        onCommit={handleCommit}
        isCommitting={commitSession.isPending}
      />
    </div>
  );
}
