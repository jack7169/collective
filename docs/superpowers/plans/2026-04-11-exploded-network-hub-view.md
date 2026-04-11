# Exploded Network Hub View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat pair cards in Similar Directories with deduplicated hub cards showing each directory's full overlap network, with a "Tag & Move" action that extracts the canonical copy and deletes peers.

**Architecture:** Frontend-only grouping transforms flat `DirectorySimilarity` pairs into `DirectoryHub[]` via a greedy algorithm scored by reclaimable GB. A new `DirectoryHubCard` component renders each hub with peer rows. A `TagMoveDialog` handles the extract-and-delete workflow using the existing actions API.

**Tech Stack:** React, TypeScript, TanStack React Query, Tailwind CSS, shadcn/Radix UI

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/lib/groupHubs.ts` | Create | Pure function: flat pairs → DirectoryHub[] |
| `frontend/src/components/results/DirectoryHubCard.tsx` | Create | Hub card with peer list, exploded network, Tag & Move |
| `frontend/src/components/results/TagMoveDialog.tsx` | Create | Path picker + preview + execute move + delete peers |
| `frontend/src/components/results/SimilarDirectoriesTab.tsx` | Modify | Use groupHubs, render hub cards instead of pair cards |

---

### Task 1: Create Hub Grouping Logic

**Files:**
- Create: `frontend/src/lib/groupHubs.ts`

- [ ] **Step 1: Create the grouping module with types and algorithm**

```typescript
// frontend/src/lib/groupHubs.ts
import type { DirectorySimilarity } from "@/api/types";

export interface PeerEntry {
  directory: string;
  similarity: number;
  relationship: string;
  sharedFiles: number;
  sharedSize: number;
  uniqueInHub: number;
  uniqueInPeer: number;
  peerFileCount: number;
  peerSize: number;
  originalPair: DirectorySimilarity;
  hubIsA: boolean;
}

export interface DirectoryHub {
  directory: string;
  fileCount: number;
  totalSize: number;
  peers: PeerEntry[];
  totalReclaimable: number;
}

/**
 * Transform flat DirectorySimilarity pairs into deduplicated DirectoryHub[].
 *
 * Algorithm:
 * 1. Build adjacency map: each directory → all its peer entries
 * 2. Score each directory by total reclaimable GB (sum of shared_size * jaccard/100)
 * 3. Greedy hub selection: highest score first, claim its peers
 * 4. Directories already claimed as peers don't become their own hub
 */
export function groupIntoHubs(pairs: DirectorySimilarity[]): DirectoryHub[] {
  if (!pairs.length) return [];

  // Build adjacency: directory → peers
  const adjacency = new Map<string, PeerEntry[]>();

  for (const pair of pairs) {
    // Add dir_b as a peer of dir_a
    const peersA = adjacency.get(pair.dir_a) ?? [];
    peersA.push({
      directory: pair.dir_b,
      similarity: pair.jaccard_similarity,
      relationship: pair.relationship ?? "overlap",
      sharedFiles: pair.shared_files,
      sharedSize: pair.shared_size,
      uniqueInHub: pair.unique_to_a,
      uniqueInPeer: pair.unique_to_b,
      peerFileCount: pair.files_b,
      peerSize: pair.size_b,
      originalPair: pair,
      hubIsA: true,
    });
    adjacency.set(pair.dir_a, peersA);

    // Add dir_a as a peer of dir_b
    const peersB = adjacency.get(pair.dir_b) ?? [];
    peersB.push({
      directory: pair.dir_a,
      similarity: pair.jaccard_similarity,
      relationship: pair.relationship === "subset"
        ? "superset"
        : pair.relationship === "superset"
          ? "subset"
          : pair.relationship ?? "overlap",
      sharedFiles: pair.shared_files,
      sharedSize: pair.shared_size,
      uniqueInHub: pair.unique_to_b,
      uniqueInPeer: pair.unique_to_a,
      peerFileCount: pair.files_a,
      peerSize: pair.size_a,
      originalPair: pair,
      hubIsA: false,
    });
    adjacency.set(pair.dir_b, peersB);
  }

  // Score each directory by total reclaimable
  const scores = new Map<string, number>();
  for (const [dir, peers] of adjacency) {
    const score = peers.reduce(
      (sum, p) => sum + p.sharedSize * (p.similarity / 100),
      0
    );
    scores.set(dir, score);
  }

  // Sort directories by score descending
  const sorted = [...adjacency.keys()].sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
  );

  // Greedy hub selection
  const claimed = new Set<string>();
  const hubs: DirectoryHub[] = [];

  for (const dir of sorted) {
    if (claimed.has(dir)) continue;

    const peers = adjacency.get(dir)!;
    const firstPeer = peers[0];

    // Get hub's own stats from first peer entry (hub is either dir_a or dir_b)
    const fileCount = firstPeer.hubIsA
      ? firstPeer.originalPair.files_a
      : firstPeer.originalPair.files_b;
    const totalSize = firstPeer.hubIsA
      ? firstPeer.originalPair.size_a
      : firstPeer.originalPair.size_b;

    // Sort peers by similarity descending
    const sortedPeers = [...peers].sort((a, b) => b.similarity - a.similarity);

    const totalReclaimable = sortedPeers.reduce(
      (sum, p) => sum + p.sharedSize * (p.similarity / 100),
      0
    );

    hubs.push({
      directory: dir,
      fileCount,
      totalSize,
      peers: sortedPeers,
      totalReclaimable,
    });

    // Claim all peers so they don't become standalone hubs
    for (const peer of sortedPeers) {
      claimed.add(peer.directory);
    }
  }

  return hubs;
}

/**
 * For a given peer directory, find its other relationships
 * (for the "Exploded Network" feature).
 */
export function getExplodedPeers(
  peerDir: string,
  hubDir: string,
  adjacency: Map<string, PeerEntry[]>
): PeerEntry[] {
  const allPeers = adjacency.get(peerDir) ?? [];
  // Exclude the current hub from the exploded list
  return allPeers.filter((p) => p.directory !== hubDir);
}

/**
 * Build the full adjacency map (exposed for exploded network lookups).
 */
export function buildAdjacency(
  pairs: DirectorySimilarity[]
): Map<string, PeerEntry[]> {
  const adjacency = new Map<string, PeerEntry[]>();
  for (const pair of pairs) {
    const peersA = adjacency.get(pair.dir_a) ?? [];
    peersA.push({
      directory: pair.dir_b,
      similarity: pair.jaccard_similarity,
      relationship: pair.relationship ?? "overlap",
      sharedFiles: pair.shared_files,
      sharedSize: pair.shared_size,
      uniqueInHub: pair.unique_to_a,
      uniqueInPeer: pair.unique_to_b,
      peerFileCount: pair.files_b,
      peerSize: pair.size_b,
      originalPair: pair,
      hubIsA: true,
    });
    adjacency.set(pair.dir_a, peersA);

    const peersB = adjacency.get(pair.dir_b) ?? [];
    peersB.push({
      directory: pair.dir_a,
      similarity: pair.jaccard_similarity,
      relationship: pair.relationship === "subset" ? "superset" : pair.relationship === "superset" ? "subset" : pair.relationship ?? "overlap",
      sharedFiles: pair.shared_files,
      sharedSize: pair.shared_size,
      uniqueInHub: pair.unique_to_b,
      uniqueInPeer: pair.unique_to_a,
      peerFileCount: pair.files_a,
      peerSize: pair.size_a,
      originalPair: pair,
      hubIsA: false,
    });
    adjacency.set(pair.dir_b, peersB);
  }
  return adjacency;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/groupHubs.ts
git commit -m "feat: add hub grouping algorithm for exploded network view"
```

---

### Task 2: Create DirectoryHubCard Component

**Files:**
- Create: `frontend/src/components/results/DirectoryHubCard.tsx`

- [ ] **Step 1: Create the hub card component**

```tsx
// frontend/src/components/results/DirectoryHubCard.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ChevronRight, ChevronDown, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SimilarityBadge } from "@/components/common/SimilarityBadge";
import { DifferencesDropdown } from "./DifferencesDropdown";
import { formatBytes, formatNumber } from "@/lib/format";
import { getRelationshipBgColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { DirectoryHub, PeerEntry } from "@/lib/groupHubs";

interface DirectoryHubCardProps {
  hub: DirectoryHub;
  scanId: string;
  isTagged: boolean;
  onTagMove: (hubDir: string) => void;
  onSkipMove: (hubDir: string) => void;
  explodedPeers: Map<string, PeerEntry[]>;
}

export function DirectoryHubCard({
  hub,
  scanId,
  isTagged,
  onTagMove,
  onSkipMove,
  explodedPeers,
}: DirectoryHubCardProps) {
  const navigate = useNavigate();
  const [expandedPeers, setExpandedPeers] = useState<Set<string>>(new Set());
  const [showDropdown, setShowDropdown] = useState(false);

  const toggleExploded = (peerDir: string) => {
    setExpandedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(peerDir)) next.delete(peerDir);
      else next.add(peerDir);
      return next;
    });
  };

  const handlePeerClick = (peer: PeerEntry) => {
    const dirA = peer.hubIsA ? hub.directory : peer.directory;
    const dirB = peer.hubIsA ? peer.directory : hub.directory;
    navigate(
      `/scans/${scanId}/compare?a=${encodeURIComponent(dirA)}&b=${encodeURIComponent(dirB)}`
    );
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        isTagged ? "border-success/30" : "border-border"
      )}
    >
      {/* Hub header */}
      <div
        className={cn(
          "p-4 border-b border-border",
          isTagged && "bg-success/5"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-foreground break-all leading-relaxed">
              {hub.directory}
            </div>
            <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
              <span>{formatNumber(hub.fileCount)} files</span>
              <span>{formatBytes(hub.totalSize)}</span>
              <span className="text-destructive font-medium">
                ~{formatBytes(hub.totalReclaimable)} reclaimable
              </span>
            </div>
          </div>
          <div className="shrink-0">
            {isTagged ? (
              <span className="text-[10px] font-semibold text-success bg-success/15 px-3 py-1.5 rounded">
                ORIGINAL
              </span>
            ) : (
              <div className="relative">
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowDropdown(!showDropdown)}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Tag & Move
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
                {showDropdown && (
                  <div className="absolute right-0 mt-1 z-10 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                    <button
                      className="w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors"
                      onClick={() => {
                        setShowDropdown(false);
                        onTagMove(hub.directory);
                      }}
                    >
                      Tag & Move to archive
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors text-muted-foreground"
                      onClick={() => {
                        setShowDropdown(false);
                        onSkipMove(hub.directory);
                      }}
                    >
                      Tag only (skip move)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary line */}
      <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">
        Overlaps with{" "}
        <strong className="text-foreground">
          {hub.peers.length} director{hub.peers.length === 1 ? "y" : "ies"}
        </strong>{" "}
        · {formatBytes(hub.peers.reduce((s, p) => s + p.sharedSize, 0))} total
        shared
      </div>

      {/* Peer rows */}
      <div>
        {hub.peers.map((peer) => {
          const dirA = peer.hubIsA ? hub.directory : peer.directory;
          const dirB = peer.hubIsA ? peer.directory : hub.directory;
          const peerExploded = explodedPeers.get(peer.directory) ?? [];
          const isExpanded = expandedPeers.has(peer.directory);

          return (
            <div
              key={peer.directory}
              className="border-b border-border last:border-b-0"
            >
              {/* Main peer row */}
              <div
                className="px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => handlePeerClick(peer)}
              >
                <div className="flex items-center gap-2.5">
                  <SimilarityBadge value={peer.similarity} />
                  {peer.relationship && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] capitalize",
                        getRelationshipBgColor(peer.relationship)
                      )}
                    >
                      {peer.relationship.replace("_", " ")}
                    </Badge>
                  )}
                  <span className="font-mono text-xs text-foreground break-all flex-1">
                    {peer.directory}
                  </span>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {formatBytes(peer.sharedSize)} shared
                  </span>
                  <span className="text-muted-foreground text-[10px]">→</span>
                </div>
                <div className="flex gap-4 mt-1 ml-16 text-[10px] text-muted-foreground">
                  <span>
                    {formatNumber(peer.peerFileCount)} files ·{" "}
                    {formatBytes(peer.peerSize)}
                  </span>
                  <span>
                    {peer.uniqueInHub} unique here · {peer.uniqueInPeer} unique
                    there
                  </span>
                </div>
              </div>

              {/* Differences dropdown */}
              <div onClick={(e) => e.stopPropagation()}>
                <DifferencesDropdown
                  scanId={scanId}
                  dirA={dirA}
                  dirB={dirB}
                  uniqueToA={peer.hubIsA ? peer.uniqueInHub : peer.uniqueInPeer}
                  uniqueToB={peer.hubIsA ? peer.uniqueInPeer : peer.uniqueInHub}
                />
              </div>

              {/* Exploded network */}
              {peerExploded.length > 0 && (
                <div className="px-4 pb-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="flex items-center gap-1.5 text-[10px] text-primary hover:text-primary/80"
                    onClick={() => toggleExploded(peer.directory)}
                  >
                    <Network className="h-3 w-3" />
                    {isExpanded ? "Hide" : "Also overlaps with"}{" "}
                    {peerExploded.length} other director
                    {peerExploded.length === 1 ? "y" : "ies"}
                  </button>
                  {isExpanded && (
                    <div className="mt-1.5 ml-4 p-2 bg-primary/5 border border-dashed border-primary/20 rounded-md">
                      {peerExploded.map((ep) => (
                        <div
                          key={ep.directory}
                          className="flex items-center gap-2 py-1 text-[10px]"
                        >
                          <SimilarityBadge
                            value={ep.similarity}
                            className="text-[9px] px-1.5 py-0"
                          />
                          <span className="font-mono text-muted-foreground truncate">
                            {ep.directory}
                          </span>
                          <span className="text-muted-foreground whitespace-nowrap">
                            {formatBytes(ep.sharedSize)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DirectoryHubCard.tsx
git commit -m "feat: add DirectoryHubCard with peer list and exploded network"
```

---

### Task 3: Create TagMoveDialog

**Files:**
- Create: `frontend/src/components/results/TagMoveDialog.tsx`

- [ ] **Step 1: Create the Tag & Move dialog**

```tsx
// frontend/src/components/results/TagMoveDialog.tsx
import { useState } from "react";
import { Loader2, ArrowRight, Trash2, FolderOutput } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PathPicker } from "@/components/scan/PathPicker";
import { formatBytes } from "@/lib/format";
import type { PeerEntry } from "@/lib/groupHubs";

interface TagMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scanId: string;
  hubDirectory: string;
  peers: PeerEntry[];
  totalReclaimable: number;
}

export function TagMoveDialog({
  open,
  onOpenChange,
  scanId,
  hubDirectory,
  peers,
  totalReclaimable,
}: TagMoveDialogProps) {
  const [destPaths, setDestPaths] = useState<string[]>([]);
  const dest = destPaths[0] ?? "";
  const queryClient = useQueryClient();

  const executeMutation = useMutation({
    mutationFn: async () => {
      const scanIdNum = Number(scanId);

      // 1. Tag as original
      await post(`/scans/${scanId}/tag-originals`, {
        original_paths: [hubDirectory],
      });

      // 2. Move hub to destination
      if (dest) {
        const moveAction = await post<{ id: number }>("/actions", {
          scan_id: scanIdNum,
          action_type: "move",
          source_path: hubDirectory,
          dest_path: dest + "/" + hubDirectory.split("/").pop(),
          notes: `Tag & Move: extract to archive`,
        });
        await post(`/actions/${moveAction.id}/confirm`, {});
      }

      // 3. Delete all peer directories
      for (const peer of peers) {
        const deleteAction = await post<{ id: number }>("/actions", {
          scan_id: scanIdNum,
          action_type: "delete",
          source_path: peer.directory,
          notes: `Tag & Move: delete peer (original: ${hubDirectory})`,
        });
        await post(`/actions/${deleteAction.id}/confirm`, {});
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans", scanId] });
      onOpenChange(false);
    },
  });

  const handleApply = () => {
    executeMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!executeMutation.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOutput className="h-5 w-5" />
            Tag & Move to Archive
          </DialogTitle>
          <DialogDescription>
            Extract the canonical copy and delete redundant peers.
          </DialogDescription>
        </DialogHeader>

        {executeMutation.isSuccess ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="text-3xl">✓</div>
            <p className="text-lg font-semibold text-success">Done</p>
            <p className="text-sm text-muted-foreground">
              Moved original and deleted {peers.length} peer
              {peers.length > 1 ? "s" : ""}
            </p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Source */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Source (original)
              </label>
              <div className="mt-1 font-mono text-xs bg-muted px-3 py-2 rounded break-all">
                {hubDirectory}
              </div>
            </div>

            {/* Destination */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Move to
              </label>
              <div className="mt-1">
                <PathPicker
                  selectedPaths={destPaths}
                  onChange={setDestPaths}
                />
              </div>
            </div>

            {/* Preview */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <ArrowRight className="h-4 w-4 text-primary" />
                <span>
                  Move to{" "}
                  <span className="font-mono text-xs">
                    {dest || "..."}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-destructive">
                <Trash2 className="h-4 w-4" />
                <span>
                  Delete {peers.length} peer director
                  {peers.length > 1 ? "ies" : "y"} (~
                  {formatBytes(totalReclaimable)} freed)
                </span>
              </div>
              <div className="ml-6 space-y-0.5">
                {peers.map((p) => (
                  <div
                    key={p.directory}
                    className="font-mono text-[10px] text-muted-foreground truncate"
                  >
                    {p.directory}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={executeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleApply}
                disabled={!dest || executeMutation.isPending}
              >
                {executeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <FolderOutput className="h-4 w-4" />
                    Move & Delete Peers
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/TagMoveDialog.tsx
git commit -m "feat: add TagMoveDialog for extract-to-archive workflow"
```

---

### Task 4: Update SimilarDirectoriesTab to Use Hub View

**Files:**
- Modify: `frontend/src/components/results/SimilarDirectoriesTab.tsx`

- [ ] **Step 1: Replace pair card rendering with hub grouping**

Replace the entire file with:

```tsx
// frontend/src/components/results/SimilarDirectoriesTab.tsx
import { useState, useCallback, useMemo } from "react";
import {
  Filter,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  useSimilarDirs,
  useTagOriginals,
  useTaggedOriginals,
} from "@/api/results";
import type { DirectorySimilarityFilters } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DirectoryHubCard } from "@/components/results/DirectoryHubCard";
import { TagMoveDialog } from "@/components/results/TagMoveDialog";
import { groupIntoHubs, buildAdjacency, getExplodedPeers } from "@/lib/groupHubs";
import { formatBytes, formatNumber } from "@/lib/format";

type SortField = "reclaimable" | "peers" | "size";

interface SimilarDirectoriesTabProps {
  scanId: string;
}

export function SimilarDirectoriesTab({ scanId }: SimilarDirectoriesTabProps) {
  const [minSimilarity, setMinSimilarity] = useState(30);
  const [sortBy, setSortBy] = useState<SortField>("reclaimable");
  const [relationship, setRelationship] = useState<string>("all");

  // Fetch ALL pairs at once for client-side hub grouping
  const filters: DirectorySimilarityFilters = {
    min_similarity: minSimilarity,
    sort_by: "impact",
    sort_order: "desc",
    relationship: relationship === "all" ? undefined : relationship,
    per_page: 500,
  };

  const { data, isLoading } = useSimilarDirs(scanId, filters);

  // Tag state
  const { data: tagData } = useTaggedOriginals(scanId);
  const tagMutation = useTagOriginals(scanId);
  const taggedPaths = useMemo(
    () => new Set(tagData?.tagged_paths ?? []),
    [tagData]
  );

  // Tag & Move dialog state
  const [tagMoveHub, setTagMoveHub] = useState<string | null>(null);

  // Group pairs into hubs
  const pairs = data?.items ?? [];
  const hubs = useMemo(() => {
    const grouped = groupIntoHubs(pairs);
    // Sort hubs
    if (sortBy === "peers") {
      grouped.sort((a, b) => b.peers.length - a.peers.length);
    } else if (sortBy === "size") {
      grouped.sort((a, b) => b.totalSize - a.totalSize);
    }
    // "reclaimable" is the default from groupIntoHubs
    return grouped;
  }, [pairs, sortBy]);

  // Build adjacency for exploded network lookups
  const adjacency = useMemo(() => buildAdjacency(pairs), [pairs]);

  // Build exploded peers map for each hub
  const getExplodedForHub = useCallback(
    (hubDir: string): Map<string, import("@/lib/groupHubs").PeerEntry[]> => {
      const map = new Map<string, import("@/lib/groupHubs").PeerEntry[]>();
      const hubPeers = adjacency.get(hubDir) ?? [];
      for (const peer of hubPeers) {
        const exploded = getExplodedPeers(peer.directory, hubDir, adjacency);
        if (exploded.length > 0) {
          map.set(peer.directory, exploded);
        }
      }
      return map;
    },
    [adjacency]
  );

  const handleTagMove = (hubDir: string) => {
    setTagMoveHub(hubDir);
  };

  const handleSkipMove = async (hubDir: string) => {
    await tagMutation.mutateAsync([hubDir]);
  };

  // Find the hub for the tag move dialog
  const tagMoveHubData = hubs.find((h) => h.directory === tagMoveHub);

  const totalReclaimable = hubs.reduce((s, h) => s + h.totalReclaimable, 0);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Similarity Threshold
                </label>
                <span className="text-sm font-mono text-primary">
                  {minSimilarity}%
                </span>
              </div>
              <Slider
                value={[minSimilarity]}
                onValueChange={([v]) => setMinSimilarity(v ?? 30)}
                min={0}
                max={100}
                step={5}
              />
              <p className="text-[11px] text-muted-foreground">
                Slide right to focus on high-confidence matches
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Sort By</label>
              <Select
                value={sortBy}
                onValueChange={(v) => setSortBy(v as SortField)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reclaimable">Reclaimable</SelectItem>
                  <SelectItem value="peers">Peer Count</SelectItem>
                  <SelectItem value="size">Directory Size</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Relationship</label>
              <Select
                value={relationship}
                onValueChange={setRelationship}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="exact">Exact</SelectItem>
                  <SelectItem value="subset">Subset</SelectItem>
                  <SelectItem value="superset">Superset</SelectItem>
                  <SelectItem value="overlap">Overlap</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="text-sm text-muted-foreground">
          {formatNumber(hubs.length)} directory hubs ·{" "}
          {formatNumber(pairs.length)} pairs at {minSimilarity}%+ ·{" "}
          <span className="text-destructive font-medium">
            ~{formatBytes(totalReclaimable)} reclaimable
          </span>
        </div>
      )}

      {/* Hub cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : hubs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            No similar directories at {minSimilarity}% threshold
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {hubs.map((hub) => (
            <DirectoryHubCard
              key={hub.directory}
              hub={hub}
              scanId={scanId}
              isTagged={taggedPaths.has(hub.directory)}
              onTagMove={handleTagMove}
              onSkipMove={handleSkipMove}
              explodedPeers={getExplodedForHub(hub.directory)}
            />
          ))}
        </div>
      )}

      {/* Tag & Move Dialog */}
      {tagMoveHubData && (
        <TagMoveDialog
          open={tagMoveHub !== null}
          onOpenChange={(open) => {
            if (!open) setTagMoveHub(null);
          }}
          scanId={scanId}
          hubDirectory={tagMoveHubData.directory}
          peers={tagMoveHubData.peers}
          totalReclaimable={tagMoveHubData.totalReclaimable}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Verify in browser**

Run: `cd frontend && npm run dev`

Navigate to a completed scan's Similar Directories tab. Verify:
- Hub cards render with directory paths, file counts, reclaimable estimates
- Peer rows show similarity, relationship, shared size
- Click peer row → Compare view
- "Also overlaps with" shows for peers with other relationships
- "Tag & Move" button opens dialog with path picker
- "Tag only (skip move)" tags without moving

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/SimilarDirectoriesTab.tsx
git commit -m "feat: replace pair cards with Exploded Network hub view"
```

---

### Task 5: Build Verification and Deploy

- [ ] **Step 1: Full frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
rsync ... root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build ... && docker stop/rm/run ..."
```
