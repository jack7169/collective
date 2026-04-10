# Duplicate Groups "Pick the Keeper" Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-click select-and-queue Duplicate Groups UI with a one-click "pick the keeper" sandbox model, smart suggestions from user patterns, and a review popup before applying to disk.

**Architecture:** A new `useKeeperSelection` hook tracks one keeper per group (Map<checksum, fileId>). `DuplicateGroupCard` is rewritten to show "Keep" buttons with green/red visual states. A new `ReviewApplyDialog` replaces the ActionQueuePanel for this tab. A new backend endpoint `POST /api/scans/{id}/suggest-keepers` detects path patterns from user decisions and suggests keepers for remaining groups.

**Tech Stack:** React, TypeScript, TanStack React Query, Tailwind CSS, shadcn/Radix UI, FastAPI, SQLAlchemy

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/hooks/useKeeperSelection.ts` | Create | Tracks keeper per group, resolved/suggested state, reclaimable bytes |
| `frontend/src/components/results/DuplicateGroupCard.tsx` | Rewrite | "Pick the keeper" card with keep/delete visual states |
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Rewrite | New toolbar with progress + suggestions + Review & Apply |
| `frontend/src/components/results/ReviewApplyDialog.tsx` | Create | Two-column review popup with grouped file analysis |
| `frontend/src/pages/ScanResults.tsx` | Modify | Remove ActionQueuePanel wiring from Duplicate Groups |
| `backend/app/api/results.py` | Modify | Add suggest-keepers endpoint |

---

### Task 1: Create useKeeperSelection Hook

**Files:**
- Create: `frontend/src/hooks/useKeeperSelection.ts`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useKeeperSelection.ts
import { useState, useCallback, useMemo } from "react";
import type { DuplicateGroup, DuplicateFileInGroup } from "@/api/types";

export interface KeeperDecision {
  checksum: string;
  keeperFileId: number;
  keeperPath: string;
  deletePaths: string[];
  reclaimableBytes: number;
}

export interface SuggestedKeeper {
  groupChecksum: string;
  suggestedFileId: number;
  confidence: number;
  reason: string;
}

export function useKeeperSelection(groups: DuplicateGroup[]) {
  // Map<checksum, fileId> — which file to keep in each group
  const [keepers, setKeepers] = useState<Map<string, number>>(new Map());
  // Suggestions from backend
  const [suggestions, setSuggestions] = useState<Map<string, SuggestedKeeper>>(new Map());

  const filesById = useMemo(() => {
    const map = new Map<number, { file: DuplicateFileInGroup; group: DuplicateGroup }>();
    for (const group of groups) {
      for (const file of group.files) {
        map.set(file.id, { file, group });
      }
    }
    return map;
  }, [groups]);

  const setKeeper = useCallback((checksum: string, fileId: number) => {
    setKeepers((prev) => {
      const next = new Map(prev);
      next.set(checksum, fileId);
      return next;
    });
  }, []);

  const clearKeeper = useCallback((checksum: string) => {
    setKeepers((prev) => {
      const next = new Map(prev);
      next.delete(checksum);
      return next;
    });
  }, []);

  const acceptSuggestion = useCallback((checksum: string) => {
    const suggestion = suggestions.get(checksum);
    if (suggestion) {
      setKeeper(checksum, suggestion.suggestedFileId);
    }
  }, [suggestions, setKeeper]);

  const acceptAllSuggestions = useCallback(() => {
    setKeepers((prev) => {
      const next = new Map(prev);
      for (const [checksum, suggestion] of suggestions) {
        if (!next.has(checksum)) {
          next.set(checksum, suggestion.suggestedFileId);
        }
      }
      return next;
    });
  }, [suggestions]);

  const updateSuggestions = useCallback((newSuggestions: SuggestedKeeper[]) => {
    const map = new Map<string, SuggestedKeeper>();
    for (const s of newSuggestions) {
      // Don't suggest for already-resolved groups
      if (!keepers.has(s.groupChecksum)) {
        map.set(s.groupChecksum, s);
      }
    }
    setSuggestions(map);
  }, [keepers]);

  // Compute resolved decisions for review
  const decisions = useMemo((): KeeperDecision[] => {
    const result: KeeperDecision[] = [];
    for (const group of groups) {
      const keeperId = keepers.get(group.checksum);
      if (keeperId == null) continue;
      const keeper = group.files.find((f) => f.id === keeperId);
      if (!keeper) continue;
      const deleteFiles = group.files.filter((f) => f.id !== keeperId);
      result.push({
        checksum: group.checksum,
        keeperFileId: keeperId,
        keeperPath: keeper.path,
        deletePaths: deleteFiles.map((f) => f.path),
        reclaimableBytes: deleteFiles.reduce((sum, f) => sum + f.size, 0),
      });
    }
    return result;
  }, [groups, keepers]);

  const resolvedCount = keepers.size;

  const totalReclaimable = useMemo(
    () => decisions.reduce((sum, d) => sum + d.reclaimableBytes, 0),
    [decisions]
  );

  const totalDeleteFiles = useMemo(
    () => decisions.reduce((sum, d) => sum + d.deletePaths.length, 0),
    [decisions]
  );

  const unresolvedSuggestionCount = useMemo(() => {
    let count = 0;
    for (const checksum of suggestions.keys()) {
      if (!keepers.has(checksum)) count++;
    }
    return count;
  }, [suggestions, keepers]);

  return {
    keepers,
    suggestions,
    setKeeper,
    clearKeeper,
    acceptSuggestion,
    acceptAllSuggestions,
    updateSuggestions,
    decisions,
    resolvedCount,
    totalReclaimable,
    totalDeleteFiles,
    unresolvedSuggestionCount,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useKeeperSelection.ts
git commit -m "feat: add useKeeperSelection hook for pick-the-keeper sandbox model"
```

---

### Task 2: Rewrite DuplicateGroupCard

**Files:**
- Rewrite: `frontend/src/components/results/DuplicateGroupCard.tsx`

- [ ] **Step 1: Rewrite the card component**

Replace the entire contents of `frontend/src/components/results/DuplicateGroupCard.tsx` with:

```tsx
// frontend/src/components/results/DuplicateGroupCard.tsx
import { Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/api/types";
import type { SuggestedKeeper } from "@/hooks/useKeeperSelection";

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  keeperFileId: number | undefined;
  suggestion: SuggestedKeeper | undefined;
  onSetKeeper: (checksum: string, fileId: number) => void;
  onClearKeeper: (checksum: string) => void;
  onAcceptSuggestion: (checksum: string) => void;
}

export function DuplicateGroupCard({
  group,
  keeperFileId,
  suggestion,
  onSetKeeper,
  onClearKeeper,
  onAcceptSuggestion,
}: DuplicateGroupCardProps) {
  const isResolved = keeperFileId != null;
  const reclaimable = isResolved
    ? group.files
        .filter((f) => f.id !== keeperFileId)
        .reduce((sum, f) => sum + f.size, 0)
    : 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        isResolved
          ? "border-success/30"
          : suggestion
            ? "border-primary/20"
            : "border-border"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {group.file_count} copies
          </Badge>
          <span className="text-sm text-muted-foreground">
            {formatBytes(group.files[0]?.size ?? 0)} each
          </span>
          {isResolved && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-destructive font-medium">
                saving {formatBytes(reclaimable)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isResolved && (
            <Badge variant="success" className="text-xs">
              <Check className="h-3 w-3 mr-1" />
              Resolved
            </Badge>
          )}
          {!isResolved && suggestion && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-primary border-primary/30"
              onClick={() => onAcceptSuggestion(group.checksum)}
            >
              Accept Suggestion
            </Button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-border">
        {group.files.map((file) => {
          const isKeeper = file.id === keeperFileId;
          const isDoomed = isResolved && !isKeeper;
          const isSuggested =
            !isResolved && suggestion?.suggestedFileId === file.id;

          return (
            <div
              key={file.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5",
                isKeeper && "bg-success/5",
                isDoomed && "bg-destructive/5 opacity-60",
                isSuggested && "border-l-2 border-l-primary"
              )}
            >
              {/* Status badge / action button */}
              <div className="shrink-0 w-24">
                {isKeeper ? (
                  <button
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success/15 px-2.5 py-1 rounded cursor-pointer hover:bg-success/25 transition-colors"
                    onClick={() => onClearKeeper(group.checksum)}
                    title="Click to unmark as keeper"
                  >
                    <Shield className="h-3 w-3" />
                    KEEP
                  </button>
                ) : isDoomed ? (
                  <span className="inline-flex items-center text-[10px] font-semibold text-destructive bg-destructive/15 px-2.5 py-1 rounded">
                    DELETE
                  </span>
                ) : isSuggested ? (
                  <button
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 border border-dashed border-primary/30 px-2.5 py-1 rounded cursor-pointer hover:bg-primary/20 transition-colors"
                    onClick={() => onSetKeeper(group.checksum, file.id)}
                  >
                    Suggested
                  </button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2.5 text-success border-success/30 hover:bg-success/10"
                    onClick={() => onSetKeeper(group.checksum, file.id)}
                  >
                    Keep
                  </Button>
                )}
              </div>

              {/* Path */}
              <div
                className={cn(
                  "flex-1 font-mono text-xs break-all leading-relaxed",
                  isDoomed
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {file.path}
              </div>

              {/* Metadata */}
              <div className="shrink-0 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>{formatBytes(file.size)}</span>
                <span className="w-20 text-right">
                  {file.mtime
                    ? new Date(file.mtime * 1000).toISOString().slice(0, 10)
                    : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in DuplicateGroupsList (old props) — that's expected, we'll fix it next task.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DuplicateGroupCard.tsx
git commit -m "feat: rewrite DuplicateGroupCard with pick-the-keeper visual states"
```

---

### Task 3: Create ReviewApplyDialog

**Files:**
- Create: `frontend/src/components/results/ReviewApplyDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
// frontend/src/components/results/ReviewApplyDialog.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/format";
import type { KeeperDecision } from "@/hooks/useKeeperSelection";

interface ReviewApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decisions: KeeperDecision[];
  totalReclaimable: number;
  totalDeleteFiles: number;
  onApply: () => Promise<void>;
}

interface DirectoryGroup {
  directory: string;
  files: string[];
  totalSize: number;
}

function groupByDirectory(paths: string[]): DirectoryGroup[] {
  const map = new Map<string, string[]>();
  for (const p of paths) {
    const lastSlash = p.lastIndexOf("/");
    const dir = lastSlash > 0 ? p.slice(0, lastSlash) : "/";
    const existing = map.get(dir);
    if (existing) {
      existing.push(p);
    } else {
      map.set(dir, [p]);
    }
  }
  return Array.from(map.entries())
    .map(([directory, files]) => ({ directory, files, totalSize: 0 }))
    .sort((a, b) => b.files.length - a.files.length);
}

function DirectoryGroupList({
  groups,
  colorClass,
}: {
  groups: DirectoryGroup[];
  colorClass: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <div key={g.directory}>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 text-left"
            onClick={() => toggle(g.directory)}
          >
            {expanded.has(g.directory) ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-mono text-xs text-foreground break-all flex-1">
              {g.directory}/
            </span>
            <span className={`text-xs font-medium shrink-0 ${colorClass}`}>
              {g.files.length} file{g.files.length > 1 ? "s" : ""}
            </span>
          </button>
          {expanded.has(g.directory) && (
            <div className="ml-6 flex flex-col gap-0.5 mb-1">
              {g.files.map((f) => (
                <div
                  key={f}
                  className="font-mono text-[11px] text-muted-foreground px-2 py-0.5"
                >
                  {f.split("/").pop()}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ReviewApplyDialog({
  open,
  onOpenChange,
  decisions,
  totalReclaimable,
  totalDeleteFiles,
  onApply,
}: ReviewApplyDialogProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    deletedCount: number;
    reclaimedBytes: number;
  } | null>(null);

  const keepPaths = decisions.map((d) => d.keeperPath);
  const deletePaths = decisions.flatMap((d) => d.deletePaths);
  const keepGroups = groupByDirectory(keepPaths);
  const deleteGroups = groupByDirectory(deletePaths);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply();
      setResult({
        success: true,
        deletedCount: totalDeleteFiles,
        reclaimedBytes: totalReclaimable,
      });
    } catch {
      setResult({ success: false, deletedCount: 0, reclaimedBytes: 0 });
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!isApplying) {
      setResult(null);
      onOpenChange(open);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review & Apply</DialogTitle>
          <DialogDescription>
            Review all changes before applying to disk. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            {result.success ? (
              <>
                <div className="text-4xl">✓</div>
                <p className="text-lg font-semibold text-success">
                  Successfully deleted {formatNumber(result.deletedCount)} files
                </p>
                <p className="text-muted-foreground">
                  Reclaimed {formatBytes(result.reclaimedBytes)}
                </p>
                <Button onClick={() => handleClose(false)}>Done</Button>
              </>
            ) : (
              <>
                <div className="text-4xl">✗</div>
                <p className="text-lg font-semibold text-destructive">
                  Some operations failed
                </p>
                <p className="text-muted-foreground">
                  Check the action log for details.
                </p>
                <Button onClick={() => handleClose(false)}>Close</Button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex items-center gap-6 py-3 px-4 rounded-lg bg-muted/50 text-sm">
              <div>
                <span className="text-muted-foreground">Keeping </span>
                <span className="font-semibold text-success">
                  {formatNumber(keepPaths.length)} files
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Deleting </span>
                <span className="font-semibold text-destructive">
                  {formatNumber(deletePaths.length)} files
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Reclaiming </span>
                <span className="font-semibold text-destructive">
                  {formatBytes(totalReclaimable)}
                </span>
              </div>
            </div>

            {/* Two-column analysis */}
            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-success mb-2">
                  Files Being Kept ({keepPaths.length})
                </h3>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  <DirectoryGroupList
                    groups={keepGroups}
                    colorClass="text-success"
                  />
                </ScrollArea>
              </div>
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-destructive mb-2">
                  Files Being Deleted ({deletePaths.length})
                </h3>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  <DirectoryGroupList
                    groups={deleteGroups}
                    colorClass="text-destructive"
                  />
                </ScrollArea>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={isApplying}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleApply}
                disabled={isApplying}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  `Apply to Disk — Delete ${formatNumber(deletePaths.length)} Files`
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (this component is standalone).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/ReviewApplyDialog.tsx
git commit -m "feat: add ReviewApplyDialog with two-column keep/delete analysis"
```

---

### Task 4: Rewrite DuplicateGroupsList

**Files:**
- Rewrite: `frontend/src/components/results/DuplicateGroupsList.tsx`

- [ ] **Step 1: Rewrite the list component**

Replace the entire contents of `frontend/src/components/results/DuplicateGroupsList.tsx` with:

```tsx
// frontend/src/components/results/DuplicateGroupsList.tsx
import { useState, useCallback } from "react";
import { Layers, FolderOpen, Loader2, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDuplicateGroups } from "@/api/results";
import { post } from "@/api/client";
import { useKeeperSelection } from "@/hooks/useKeeperSelection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DuplicateGroupCard } from "./DuplicateGroupCard";
import { ReviewApplyDialog } from "./ReviewApplyDialog";
import { formatBytes, formatNumber } from "@/lib/format";

interface DuplicateGroupsListProps {
  scanId: string;
}

interface SuggestKeepersResponse {
  suggestions: Array<{
    group_checksum: string;
    suggested_file_id: number;
    confidence: number;
    reason: string;
  }>;
  pattern: {
    preferred_prefix: string;
    match_count: number;
    total_decisions: number;
  } | null;
}

export function DuplicateGroupsList({ scanId }: DuplicateGroupsListProps) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("size");
  const [showReview, setShowReview] = useState(false);
  const { data, isLoading } = useDuplicateGroups(scanId, page, 20, sortBy);
  const groups = data?.items ?? [];
  const queryClient = useQueryClient();

  const selection = useKeeperSelection(groups);

  // Fetch suggestions from backend
  const suggestMutation = useMutation({
    mutationFn: (decisions: Array<{ group_checksum: string; kept_file_id: number }>) =>
      post<SuggestKeepersResponse>(`/scans/${scanId}/suggest-keepers`, {
        decisions,
      }),
    onSuccess: (data) => {
      selection.updateSuggestions(
        data.suggestions.map((s) => ({
          groupChecksum: s.group_checksum,
          suggestedFileId: s.suggested_file_id,
          confidence: s.confidence,
          reason: s.reason,
        }))
      );
    },
  });

  // Request suggestions after each manual keeper pick
  const handleSetKeeper = useCallback(
    (checksum: string, fileId: number) => {
      selection.setKeeper(checksum, fileId);

      // Build decisions list including the new one
      const allDecisions: Array<{ group_checksum: string; kept_file_id: number }> = [];
      for (const group of groups) {
        const existing = selection.keepers.get(group.checksum);
        if (existing != null) {
          allDecisions.push({ group_checksum: group.checksum, kept_file_id: existing });
        }
      }
      // Add the one we just set (may not be in keepers yet due to setState batching)
      if (!allDecisions.some((d) => d.group_checksum === checksum)) {
        allDecisions.push({ group_checksum: checksum, kept_file_id: fileId });
      }

      // Request suggestions once we have 3+ decisions
      if (allDecisions.length >= 3) {
        suggestMutation.mutate(allDecisions);
      }
    },
    [groups, selection, suggestMutation]
  );

  // Execute all deletions via the actions API
  const executeMutation = useMutation({
    mutationFn: async () => {
      const results: Array<{ success: boolean; path: string }> = [];
      for (const decision of selection.decisions) {
        for (const path of decision.deletePaths) {
          try {
            const action = await post<{ id: number }>("/actions", {
              scan_id: Number(scanId),
              action_type: "delete",
              source_path: path,
              notes: `Keep: ${decision.keeperPath}`,
            });
            await post(`/actions/${action.id}/confirm`, {});
            results.push({ success: true, path });
          } catch {
            results.push({ success: false, path });
          }
        }
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans", scanId] });
    },
  });

  const handleApply = async () => {
    await executeMutation.mutateAsync();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading duplicate groups...
      </div>
    );
  }

  if (!data?.items || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No duplicate file groups found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Select
            value={sortBy}
            onValueChange={(v) => {
              setSortBy(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="size">Sort by Size</SelectItem>
              <SelectItem value="file_count">Sort by Count</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground">
            {selection.resolvedCount} of {formatNumber(data.total)} groups
            resolved
            {selection.totalReclaimable > 0 && (
              <>
                {" · "}
                <span className="text-destructive font-medium">
                  {formatBytes(selection.totalReclaimable)} reclaimable
                </span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selection.unresolvedSuggestionCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={selection.acceptAllSuggestions}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Accept All Suggestions ({selection.unresolvedSuggestionCount})
            </Button>
          )}
          <Button
            size="sm"
            disabled={selection.resolvedCount === 0}
            onClick={() => setShowReview(true)}
          >
            Review & Apply
          </Button>
        </div>
      </div>

      {/* Group cards */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <DuplicateGroupCard
            key={group.checksum}
            group={group}
            keeperFileId={selection.keepers.get(group.checksum)}
            suggestion={selection.suggestions.get(group.checksum)}
            onSetKeeper={handleSetKeeper}
            onClearKeeper={selection.clearKeeper}
            onAcceptSuggestion={selection.acceptSuggestion}
          />
        ))}
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.pages} (
            {formatNumber(data.total)} groups)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Review dialog */}
      <ReviewApplyDialog
        open={showReview}
        onOpenChange={setShowReview}
        decisions={selection.decisions}
        totalReclaimable={selection.totalReclaimable}
        totalDeleteFiles={selection.totalDeleteFiles}
        onApply={handleApply}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in ScanResults.tsx (old props for DuplicateGroupsList) — fixed next task.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DuplicateGroupsList.tsx
git commit -m "feat: rewrite DuplicateGroupsList with keeper toolbar, suggestions, and review flow"
```

---

### Task 5: Update ScanResults — Remove ActionQueuePanel Wiring

**Files:**
- Modify: `frontend/src/pages/ScanResults.tsx`

- [ ] **Step 1: Remove actionQueue and ActionQueuePanel imports and usage**

In `frontend/src/pages/ScanResults.tsx`:

Remove the ActionQueuePanel and useActionQueue imports:
```tsx
// REMOVE these lines:
import { ActionQueuePanel } from "@/components/common/ActionQueuePanel";
import { useActionQueue } from "@/hooks/useActionQueue";
```

Remove the actionQueue hook call:
```tsx
// REMOVE this line:
const actionQueue = useActionQueue();
```

Change the DuplicateGroupsList props — it no longer takes `addAction`:
```tsx
// REPLACE:
            <DuplicateGroupsList
              scanId={id}
              addAction={actionQueue.addAction}
            />
// WITH:
            <DuplicateGroupsList scanId={id} />
```

Remove the entire ActionQueuePanel component:
```tsx
// REMOVE this entire block:
      <ActionQueuePanel
        queue={actionQueue.queue}
        onRemove={actionQueue.removeAction}
        onReorder={actionQueue.reorderAction}
        onClear={actionQueue.clearQueue}
        onExecute={actionQueue.executeQueue}
        isExecuting={actionQueue.isExecuting}
        lastResult={actionQueue.lastResult}
        totalEstimatedSize={actionQueue.totalEstimatedSize}
      />
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ScanResults.tsx
git commit -m "feat: remove ActionQueuePanel from ScanResults (replaced by ReviewApplyDialog)"
```

---

### Task 6: Add Backend suggest-keepers Endpoint

**Files:**
- Modify: `backend/app/api/results.py`

- [ ] **Step 1: Add the endpoint**

Add the following at the end of `backend/app/api/results.py` (before the file ends):

```python
class KeeperDecision(BaseModel):
    group_checksum: str
    kept_file_id: int


class SuggestKeepersRequest(BaseModel):
    decisions: list[KeeperDecision]


class SuggestedKeeper(BaseModel):
    group_checksum: str
    suggested_file_id: int
    confidence: float
    reason: str


class SuggestKeepersResponse(BaseModel):
    suggestions: list[SuggestedKeeper]
    pattern: Optional[dict] = None


@router.post("/suggest-keepers")
async def suggest_keepers(
    scan_id: int,
    body: SuggestKeepersRequest,
    db: AsyncSession = Depends(get_db),
):
    """Analyze user keeper decisions and suggest keepers for remaining groups."""
    await _get_scan_or_404(db, scan_id)

    if len(body.decisions) < 3:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    # Fetch the kept files to extract their paths
    kept_ids = [d.kept_file_id for d in body.decisions]
    result = await db.execute(
        select(DuplicateFile).where(
            DuplicateFile.scan_id == scan_id,
            DuplicateFile.id.in_(kept_ids),
        )
    )
    kept_files = {f.id: f for f in result.scalars().all()}

    # Extract directory prefixes from kept files
    import os
    prefix_counts: dict[str, int] = {}
    for decision in body.decisions:
        f = kept_files.get(decision.kept_file_id)
        if not f:
            continue
        parent = os.path.dirname(f.path)
        # Walk up to find common prefixes
        parts = parent.split("/")
        for i in range(2, len(parts) + 1):
            prefix = "/".join(parts[:i])
            prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1

    if not prefix_counts:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    # Find the most specific prefix that matches most decisions
    total = len(body.decisions)
    best_prefix = ""
    best_score = 0
    for prefix, count in prefix_counts.items():
        # Score: match_ratio * specificity (longer prefix = more specific)
        score = (count / total) * len(prefix)
        if count >= 2 and score > best_score:
            best_prefix = prefix
            best_score = score

    if not best_prefix:
        return SuggestKeepersResponse(suggestions=[], pattern=None)

    match_count = prefix_counts[best_prefix]
    confidence = match_count / total

    # Find unresolved groups and suggest keepers
    decided_checksums = {d.group_checksum for d in body.decisions}

    # Get all duplicate groups for this scan (only checksums not yet decided)
    from sqlalchemy import literal_column
    groups_q = (
        select(
            DuplicateFile.checksum,
            func.count().label("cnt"),
        )
        .where(DuplicateFile.scan_id == scan_id)
        .group_by(DuplicateFile.checksum)
        .having(func.count() > 1)
    )
    groups_result = await db.execute(groups_q)
    all_checksums = {row.checksum for row in groups_result}
    undecided = all_checksums - decided_checksums

    if not undecided:
        return SuggestKeepersResponse(
            suggestions=[],
            pattern={
                "preferred_prefix": best_prefix,
                "match_count": match_count,
                "total_decisions": total,
            },
        )

    # Fetch files for undecided groups
    files_q = select(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id,
        DuplicateFile.checksum.in_(undecided),
    )
    files_result = await db.execute(files_q)
    files_by_checksum: dict[str, list] = {}
    for f in files_result.scalars().all():
        files_by_checksum.setdefault(f.checksum, []).append(f)

    # For each undecided group, see if exactly one file matches the pattern
    suggestions = []
    for checksum, files in files_by_checksum.items():
        matching = [f for f in files if f.path.startswith(best_prefix + "/")]
        if len(matching) == 1:
            suggestions.append(SuggestedKeeper(
                group_checksum=checksum,
                suggested_file_id=matching[0].id,
                confidence=confidence,
                reason=f"Path matches pattern: {best_prefix}/",
            ))

    return SuggestKeepersResponse(
        suggestions=suggestions,
        pattern={
            "preferred_prefix": best_prefix,
            "match_count": match_count,
            "total_decisions": total,
        },
    )
```

- [ ] **Step 2: Verify backend loads**

Run: `cd backend && python -c "from app.api.results import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/results.py
git commit -m "feat: add suggest-keepers endpoint for smart pattern-based suggestions"
```

---

### Task 7: Build Verification and Cleanup

- [ ] **Step 1: Full frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Verify backend syntax**

Run: `cd backend && python -c "import ast; ast.parse(open('app/api/results.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Remove dead hook file**

Delete `frontend/src/hooks/useGroupSelection.ts` — it's been replaced by `useKeeperSelection.ts` and no longer imported anywhere.

```bash
rm frontend/src/hooks/useGroupSelection.ts
```

Verify no remaining imports:

Run: `grep -r "useGroupSelection" frontend/src/`
Expected: No matches.

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove dead useGroupSelection hook, verify build"
```

---

### Task 8: End-to-End Verification

- [ ] **Step 1: Start dev servers**

```bash
cd backend && uvicorn app.main:app --reload --port 8080 &
cd frontend && npm run dev &
```

- [ ] **Step 2: Test the full workflow**

1. Navigate to a completed scan's results page
2. Click "Duplicate Groups" tab
3. Verify cards show with "Keep" button per file
4. Click "Keep" on a file → keeper turns green, others turn red with strikethrough
5. Click "Keep" on a different file in the same group → keeper switches
6. Click the KEEP badge → group unmarks, returns to unresolved
7. Resolve 3+ groups → verify toolbar shows "{N} of {total} groups resolved · {size} reclaimable"
8. After 3 resolutions, verify suggestions appear on unresolved groups (dashed border + "Suggested" badge)
9. Click "Accept Suggestion" on one → group resolves
10. Click "Accept All Suggestions" → remaining suggestions resolve
11. Click "Review & Apply" → popup shows summary + two-column analysis
12. Verify "Files Being Kept" and "Files Being Deleted" lists grouped by directory, expandable
13. Click "Cancel" → returns to sandbox, decisions preserved
14. Click "Review & Apply" again → "Apply to Disk" → executes, shows success

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
