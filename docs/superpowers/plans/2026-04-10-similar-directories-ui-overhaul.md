# Similar Directories UI Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the truncated table + disconnected PathPicker on the Similar Directories page with a card-based layout featuring inline tagging, a differences dropdown with date analysis, remove the broken Exact Duplicates tab, and fix the Compare view blank screen with progressive loading.

**Architecture:** The Similar Directories page becomes a list of `DirectoryPairCard` components, each with an expandable `DifferencesDropdown` that lazy-loads file diffs from the existing `/compare` endpoint. A `TagFloatingBar` provides batch tag application. The Exact Duplicates tab and its backend are removed. The Compare view renders DB data instantly while the tree-diff loads progressively.

**Tech Stack:** React, TypeScript, TanStack React Query, Tailwind CSS, shadcn/Radix UI, FastAPI, SQLAlchemy

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/results/DirectoryPairCard.tsx` | Create | Single directory pair card with stats bar, side-by-side panels, tag buttons |
| `frontend/src/components/results/DifferencesDropdown.tsx` | Create | Collapsible unique files viewer with lazy loading, verdict banner, Load more |
| `frontend/src/components/results/TagFloatingBar.tsx` | Create | Fixed-position bar for pending tag actions |
| `frontend/src/pages/SimilarDirectories.tsx` | Rewrite | Card layout orchestration, filter bar, pagination, tag state management |
| `frontend/src/pages/ScanResults.tsx` | Modify | Remove Exact Duplicates tab |
| `frontend/src/pages/DirectoryCompare.tsx` | Modify | Two-phase progressive rendering |
| `frontend/src/api/results.ts` | Modify | Remove `useDuplicateDirs` hook |
| `frontend/src/api/types.ts` | Modify | Remove `DuplicateDirectory` interface |
| `backend/app/api/results.py` | Modify | Remove `list_duplicate_dirs` endpoint, remove `DuplicateDirectory` import |
| `backend/app/tasks/scan_tasks.py` | Modify | Remove DuplicateDirectory population logic |

---

### Task 1: Create DirectoryPairCard Component

**Files:**
- Create: `frontend/src/components/results/DirectoryPairCard.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/results/DirectoryPairCard.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SimilarityBadge } from "@/components/common/SimilarityBadge";
import { DifferencesDropdown } from "./DifferencesDropdown";
import { formatBytes, formatNumber } from "@/lib/format";
import { getRelationshipBgColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { DirectorySimilarity } from "@/api/types";

interface DirectoryPairCardProps {
  pair: DirectorySimilarity;
  scanId: string;
  taggedPaths: Set<string>;
  onToggleTag: (path: string) => void;
}

export function DirectoryPairCard({
  pair,
  scanId,
  taggedPaths,
  onToggleTag,
}: DirectoryPairCardProps) {
  const navigate = useNavigate();
  const aIsTagged = taggedPaths.has(pair.dir_a);
  const bIsTagged = taggedPaths.has(pair.dir_b);

  const handleCardClick = () => {
    navigate(
      `/scans/${scanId}/compare?a=${encodeURIComponent(pair.dir_a)}&b=${encodeURIComponent(pair.dir_b)}`
    );
  };

  return (
    <div
      className="rounded-lg border border-border bg-card hover:border-primary/40 transition-colors cursor-pointer"
      onClick={handleCardClick}
    >
      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <SimilarityBadge value={pair.jaccard_similarity} />
          {pair.relationship && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs capitalize",
                getRelationshipBgColor(pair.relationship)
              )}
            >
              {pair.relationship.replace("_", " ")}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {formatNumber(pair.shared_files)} shared files
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">
            {formatBytes(pair.shared_size)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Click to compare →
        </span>
      </div>

      {/* Side-by-side directory panels */}
      <div className="grid grid-cols-2">
        {/* Directory A */}
        <div
          className={cn(
            "p-4 border-r border-border",
            aIsTagged && "bg-success/5"
          )}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Directory A
            </span>
            {aIsTagged && (
              <span className="text-[9px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded">
                🛡️ ORIGINAL
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-foreground break-all leading-relaxed">
            {pair.dir_a}
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
            <span>{formatNumber(pair.files_a)} files</span>
            <span>{formatBytes(pair.size_a)}</span>
            <span>A in B: {pair.a_subset_pct.toFixed(1)}%</span>
          </div>
          <Button
            variant={aIsTagged ? "default" : "outline"}
            size="sm"
            className={cn(
              "mt-2.5 text-xs",
              aIsTagged &&
                "bg-success/20 border-success/40 text-success hover:bg-success/30"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTag(pair.dir_a);
            }}
          >
            {aIsTagged ? (
              <>
                <Check className="h-3.5 w-3.5" /> Tagged as Original
              </>
            ) : (
              <>
                <Shield className="h-3.5 w-3.5" /> Mark as Original
              </>
            )}
          </Button>
        </div>

        {/* Directory B */}
        <div className={cn("p-4", bIsTagged && "bg-success/5")}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Directory B
            </span>
            {bIsTagged && (
              <span className="text-[9px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded">
                🛡️ ORIGINAL
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-foreground break-all leading-relaxed">
            {pair.dir_b}
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
            <span>{formatNumber(pair.files_b)} files</span>
            <span>{formatBytes(pair.size_b)}</span>
            <span>B in A: {pair.b_subset_pct.toFixed(1)}%</span>
          </div>
          <Button
            variant={bIsTagged ? "default" : "outline"}
            size="sm"
            className={cn(
              "mt-2.5 text-xs",
              bIsTagged &&
                "bg-success/20 border-success/40 text-success hover:bg-success/30"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTag(pair.dir_b);
            }}
          >
            {bIsTagged ? (
              <>
                <Check className="h-3.5 w-3.5" /> Tagged as Original
              </>
            ) : (
              <>
                <Shield className="h-3.5 w-3.5" /> Mark as Original
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Differences dropdown */}
      <DifferencesDropdown
        scanId={scanId}
        dirA={pair.dir_a}
        dirB={pair.dir_b}
        uniqueToA={pair.unique_to_a}
        uniqueToB={pair.unique_to_b}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

This will have errors for `DifferencesDropdown` which doesn't exist yet — that's expected. Verify no errors in DirectoryPairCard itself.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DirectoryPairCard.tsx
git commit -m "feat: add DirectoryPairCard component for card-based similar dirs layout"
```

---

### Task 2: Create DifferencesDropdown Component

**Files:**
- Create: `frontend/src/components/results/DifferencesDropdown.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/results/DifferencesDropdown.tsx
import { useState } from "react";
import { ChevronRight, ChevronDown, ArrowRight, AlertTriangle, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useCompare } from "@/api/results";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { CompareFile } from "@/api/types";

interface DifferencesDropdownProps {
  scanId: string;
  dirA: string;
  dirB: string;
  uniqueToA: number;
  uniqueToB: number;
}

const FILES_PER_PAGE = 10;

function formatMtime(mtime: string): string {
  if (!mtime) return "—";
  const date = new Date(typeof mtime === "number" ? mtime * 1000 : mtime);
  if (isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function computeVerdict(
  onlyInA: CompareFile[],
  onlyInB: CompareFile[]
): { type: "newer_b" | "newer_a" | "merge" | "identical"; message: string } {
  if (onlyInA.length === 0 && onlyInB.length === 0) {
    return { type: "identical", message: "Identical — safe to remove either copy" };
  }

  const mtimesA = onlyInA
    .map((f) => (typeof f.mtime === "number" ? f.mtime : new Date(f.mtime).getTime() / 1000))
    .filter((t) => t > 0);
  const mtimesB = onlyInB
    .map((f) => (typeof f.mtime === "number" ? f.mtime : new Date(f.mtime).getTime() / 1000))
    .filter((t) => t > 0);

  if (mtimesA.length === 0 || mtimesB.length === 0) {
    if (onlyInA.length > 0 && onlyInB.length > 0) {
      return { type: "merge", message: "Both sides have unique files — merge recommended" };
    }
    if (onlyInB.length > 0) {
      return { type: "newer_b", message: "B has files not in A" };
    }
    return { type: "newer_a", message: "A has files not in B" };
  }

  const maxA = Math.max(...mtimesA);
  const maxB = Math.max(...mtimesB);
  const minA = Math.min(...mtimesA);
  const minB = Math.min(...mtimesB);

  if (onlyInA.length === 0 && onlyInB.length > 0) {
    return {
      type: "newer_b",
      message: `B appears to be a newer version of A — B has ${onlyInB.length} file${onlyInB.length > 1 ? "s" : ""} not in A`,
    };
  }
  if (onlyInB.length === 0 && onlyInA.length > 0) {
    return {
      type: "newer_a",
      message: `A appears to be a newer version of B — A has ${onlyInA.length} file${onlyInA.length > 1 ? "s" : ""} not in B`,
    };
  }

  // Both sides have unique files — check date overlap
  if (minB > maxA) {
    return {
      type: "newer_b",
      message: `B appears to be a newer version of A — B's unique files are all newer`,
    };
  }
  if (minA > maxB) {
    return {
      type: "newer_a",
      message: `A appears to be a newer version of B — A's unique files are all newer`,
    };
  }

  return {
    type: "merge",
    message: "Both sides have unique files with overlapping dates — merge recommended",
  };
}

function FileList({
  files,
  label,
  totalSize,
  colorClass,
  bgClass,
}: {
  files: CompareFile[];
  label: string;
  totalSize: number;
  colorClass: string;
  bgClass: string;
}) {
  const [visibleCount, setVisibleCount] = useState(FILES_PER_PAGE);
  const visible = files.slice(0, visibleCount);
  const remaining = files.length - visibleCount;

  const mtimes = files
    .map((f) => (typeof f.mtime === "number" ? f.mtime : new Date(f.mtime).getTime() / 1000))
    .filter((t) => t > 0);
  const minDate = mtimes.length > 0 ? formatMtime(String(Math.min(...mtimes))) : null;
  const maxDate = mtimes.length > 0 ? formatMtime(String(Math.max(...mtimes))) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${colorClass}`}>
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(totalSize)} total
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((file) => (
          <div
            key={file.path}
            className={`flex items-center justify-between px-2 py-1 rounded text-[11px] ${bgClass}`}
          >
            <span className="font-mono text-foreground truncate mr-3">
              {file.name}
            </span>
            <span className="font-mono text-muted-foreground whitespace-nowrap">
              {formatMtime(file.mtime)}
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-primary mt-1 h-7"
            onClick={(e) => {
              e.stopPropagation();
              setVisibleCount((c) => c + FILES_PER_PAGE);
            }}
          >
            Load {Math.min(remaining, FILES_PER_PAGE)} more ({remaining} remaining)
          </Button>
        )}
      </div>
      {minDate && maxDate && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          Date range: <span className="text-foreground">{minDate}</span> →{" "}
          <span className="text-foreground">{maxDate}</span>
        </div>
      )}
    </div>
  );
}

export function DifferencesDropdown({
  scanId,
  dirA,
  dirB,
  uniqueToA,
  uniqueToB,
}: DifferencesDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasAnyDifferences = uniqueToA > 0 || uniqueToB > 0;

  // Only fetch comparison data when dropdown is opened
  const { data: compare, isLoading } = useCompare(
    isOpen ? scanId : undefined,
    isOpen ? dirA : null,
    isOpen ? dirB : null
  );

  const verdict = compare
    ? computeVerdict(compare.only_in_a, compare.only_in_b)
    : null;

  const verdictIcon = {
    newer_a: <ArrowRight className="h-4 w-4 text-blue-400 rotate-180" />,
    newer_b: <ArrowRight className="h-4 w-4 text-blue-400" />,
    merge: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    identical: <CheckCircle className="h-4 w-4 text-success" />,
  };

  const verdictColor = {
    newer_a: "text-blue-400",
    newer_b: "text-blue-400",
    merge: "text-amber-400",
    identical: "text-success",
  };

  if (!hasAnyDifferences) {
    return (
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground flex items-center gap-2">
        <CheckCircle className="h-3.5 w-3.5 text-success" />
        Identical — no unique files on either side
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Toggle bar */}
      <button
        className="w-full px-4 py-2 flex items-center gap-2 hover:bg-accent/50 transition-colors text-left"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-primary">Show differences</span>
        <span className="text-[11px] text-muted-foreground">
          — {uniqueToA} unique to A · {uniqueToB} unique to B
        </span>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="bg-background/50">
          {isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Loading file details...
            </div>
          ) : compare ? (
            <>
              {/* Verdict banner */}
              {verdict && (
                <div className="px-4 py-2.5 border-t border-border flex items-center gap-2">
                  {verdictIcon[verdict.type]}
                  <span className={`text-xs font-semibold ${verdictColor[verdict.type]}`}>
                    {verdict.message}
                  </span>
                </div>
              )}

              {/* File lists side by side */}
              <div className="grid grid-cols-2 border-t border-border">
                <div className="p-3 border-r border-border">
                  <FileList
                    files={compare.only_in_a}
                    label={`${compare.only_in_a.length} files only in A`}
                    totalSize={compare.only_a_size}
                    colorClass="text-orange-400"
                    bgClass="bg-orange-500/5"
                  />
                </div>
                <div className="p-3">
                  <FileList
                    files={compare.only_in_b}
                    label={`${compare.only_in_b.length} files only in B`}
                    totalSize={compare.only_b_size}
                    colorClass="text-blue-400"
                    bgClass="bg-blue-500/5"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-4 py-2.5 border-t border-border flex justify-end gap-2">
                {verdict?.type === "newer_b" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-blue-400 border-blue-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge B → A
                  </Button>
                )}
                {verdict?.type === "newer_a" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-blue-400 border-blue-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge A → B
                  </Button>
                )}
                {verdict?.type === "merge" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-amber-400 border-amber-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge Both
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    to={`/scans/${scanId}/compare?a=${encodeURIComponent(dirA)}&b=${encodeURIComponent(dirB)}`}
                  >
                    Open Full Compare
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors in DifferencesDropdown.tsx (DirectoryPairCard should now also resolve its import).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/DifferencesDropdown.tsx
git commit -m "feat: add DifferencesDropdown with lazy-loaded file diffs and date analysis"
```

---

### Task 3: Create TagFloatingBar Component

**Files:**
- Create: `frontend/src/components/results/TagFloatingBar.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/results/TagFloatingBar.tsx
import { Shield, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

interface TagFloatingBarProps {
  taggedPaths: Set<string>;
  onClear: () => void;
  onApply: () => void;
  isPending: boolean;
  result?: {
    files_tagged_as_original: number;
    space_recoverable: number;
  } | null;
}

export function TagFloatingBar({
  taggedPaths,
  onClear,
  onApply,
  isPending,
  result,
}: TagFloatingBarProps) {
  if (taggedPaths.size === 0 && !result) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4">
      <div className="rounded-lg border border-success/30 bg-card/95 backdrop-blur-sm shadow-lg px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="h-4 w-4 text-success shrink-0" />
          {result ? (
            <span className="text-sm text-success">
              {result.files_tagged_as_original} files tagged ·{" "}
              {formatBytes(result.space_recoverable)} recoverable
            </span>
          ) : (
            <span className="text-sm text-success font-medium">
              {taggedPaths.size} director{taggedPaths.size === 1 ? "y" : "ies"}{" "}
              tagged as original
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onClear}
            disabled={isPending}
          >
            <X className="h-3.5 w-3.5" />
            Clear All
          </Button>
          <Button
            size="sm"
            className="text-xs bg-success/20 border-success/40 text-success hover:bg-success/30"
            onClick={onApply}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Recalculating...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Apply Tags & Recalculate
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/results/TagFloatingBar.tsx
git commit -m "feat: add TagFloatingBar for batch original tagging"
```

---

### Task 4: Rewrite SimilarDirectories Page

**Files:**
- Modify: `frontend/src/pages/SimilarDirectories.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the page with card layout**

Replace the entire contents of `frontend/src/pages/SimilarDirectories.tsx` with:

```tsx
// frontend/src/pages/SimilarDirectories.tsx
import { useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
import { DirectoryPairCard } from "@/components/results/DirectoryPairCard";
import { TagFloatingBar } from "@/components/results/TagFloatingBar";
import { formatNumber } from "@/lib/format";

type SortField = "similarity" | "size" | "files";
type SortOrder = "asc" | "desc";

const sortFieldToApi: Record<SortField, string> = {
  similarity: "jaccard_similarity",
  size: "shared_size",
  files: "shared_files",
};

export function SimilarDirectories() {
  const { id } = useParams<{ id: string }>();
  const [minSimilarity, setMinSimilarity] = useState(30);
  const [sortBy, setSortBy] = useState<SortField>("size");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [relationship, setRelationship] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Tag state — using Set for O(1) lookups across all cards
  const { data: tagData } = useTaggedOriginals(id);
  const tagMutation = useTagOriginals(id);
  const [taggedPaths, setTaggedPaths] = useState<Set<string>>(new Set());
  const [tagsInitialized, setTagsInitialized] = useState(false);

  // Initialize tagged paths from server (once)
  const serverTags = tagData?.tagged_paths ?? [];
  if (serverTags.length > 0 && !tagsInitialized) {
    setTaggedPaths(new Set(serverTags));
    setTagsInitialized(true);
  }

  const filters: DirectorySimilarityFilters = {
    min_similarity: minSimilarity,
    sort_by: sortFieldToApi[sortBy],
    sort_order: sortOrder,
    relationship: relationship === "all" ? undefined : relationship,
    page,
    per_page: 25,
  };

  const { data, isLoading } = useSimilarDirs(id, filters);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(field);
        setSortOrder("desc");
      }
      setPage(1);
    },
    [sortBy]
  );

  const handleToggleTag = useCallback((path: string) => {
    setTaggedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleApplyTags = async () => {
    await tagMutation.mutateAsync(Array.from(taggedPaths));
  };

  const handleClearTags = () => {
    setTaggedPaths(new Set());
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field)
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Similar Directories
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare directory pairs, tag originals, and take action on duplicates.
        </p>
      </div>

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
                onValueChange={([v]) => {
                  setMinSimilarity(v ?? 30);
                  setPage(1);
                }}
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
                onValueChange={(v) => {
                  setSortBy(v as SortField);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="similarity">Similarity</SelectItem>
                  <SelectItem value="size">Shared Size</SelectItem>
                  <SelectItem value="files">File Count</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Relationship</label>
              <Select
                value={relationship}
                onValueChange={(v) => {
                  setRelationship(v);
                  setPage(1);
                }}
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
                  <SelectItem value="structural_match">Structural</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="text-sm text-muted-foreground">
          {formatNumber(data.total)} directory pairs at {minSimilarity}%+
        </div>
      )}

      {/* Card list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : !data?.items || data.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            No similar directories at {minSimilarity}% threshold
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Try lowering the similarity threshold
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {data.items.map((pair) => (
              <DirectoryPairCard
                key={pair.id}
                pair={pair}
                scanId={id!}
                taggedPaths={taggedPaths}
                onToggleTag={handleToggleTag}
              />
            ))}
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <span className="text-sm text-muted-foreground">
                Page {data.page} of {data.pages} (
                {formatNumber(data.total)} pairs)
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
        </>
      )}

      {/* Floating tag bar */}
      <TagFloatingBar
        taggedPaths={taggedPaths}
        onClear={handleClearTags}
        onApply={handleApplyTags}
        isPending={tagMutation.isPending}
        result={tagMutation.isSuccess ? tagMutation.data : null}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Visual check in browser**

Run: `cd frontend && npm run dev`

Navigate to a scan's Similar Directories page. Verify:
- Cards render with full paths (no truncation)
- Stats bar shows Jaccard %, Type, shared files + size
- Tag buttons toggle correctly
- "Show differences" dropdown expands and lazy-loads file data
- "Load more" button works in file lists
- Verdict banner appears with correct analysis
- Floating bar appears when paths are tagged
- Clicking card navigates to Compare view

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SimilarDirectories.tsx
git commit -m "feat: rewrite SimilarDirectories page with card layout and inline tagging"
```

---

### Task 5: Remove Exact Duplicates Tab from ScanResults

**Files:**
- Modify: `frontend/src/pages/ScanResults.tsx`

- [ ] **Step 1: Remove the Exact Duplicates tab trigger and content**

In `frontend/src/pages/ScanResults.tsx`:

Remove the `useDuplicateDirs` import (line 17):
```tsx
// REMOVE this line:
import { useDuplicateDirs } from "@/api/results";
```

Remove the `DuplicateDirectory` type import (line 18):
```tsx
// REMOVE this line:
import type { DuplicateDirectory } from "@/api/types";
```

Remove the `dupDirsData` query (line 51):
```tsx
// REMOVE this line:
const { data: dupDirsData } = useDuplicateDirs(scanExists ? id : undefined);
```

Remove the `TabsTrigger` for "Exact Duplicates" (line 171):
```tsx
// REMOVE this line:
<TabsTrigger value="duplicates">Exact Duplicates</TabsTrigger>
```

Remove the entire `TabsContent value="duplicates"` block (lines 246-306):
```tsx
// REMOVE everything from:
{/* Exact Duplicates */}
<TabsContent value="duplicates">
// ... through to its closing:
</TabsContent>
```

Also remove the `Files` icon from the lucide-react imports if it's no longer used elsewhere in the file. Check by searching for `Files` usage — it was used in the empty state of the Exact Duplicates tab. If `Files` is still used in other parts of the component, keep it.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors. If there are unused import warnings, clean them up.

- [ ] **Step 3: Verify in browser**

Navigate to a scan's results page. Verify:
- Only 3 tabs remain: Overview, Duplicate Groups, Similar Directories
- No "Exact Duplicates" tab visible
- All remaining tabs work correctly

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ScanResults.tsx
git commit -m "feat: remove Exact Duplicates tab (replaced by Similar Directories card view)"
```

---

### Task 6: Remove Dead Backend + Frontend Code for Exact Duplicates

**Files:**
- Modify: `frontend/src/api/results.ts` — remove `useDuplicateDirs`
- Modify: `frontend/src/api/types.ts` — remove `DuplicateDirectory`
- Modify: `backend/app/api/results.py` — remove `list_duplicate_dirs` endpoint and `DuplicateDirectory` import
- Modify: `backend/app/tasks/scan_tasks.py` — remove DuplicateDirectory population logic

- [ ] **Step 1: Remove frontend dead code**

In `frontend/src/api/results.ts`, remove the `useDuplicateDirs` function (lines 17-26):
```tsx
// REMOVE this entire function:
export function useDuplicateDirs(scanId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ["scans", scanId, "duplicate-dirs", page],
    queryFn: () =>
      get<PaginatedResponse<DuplicateDirectory>>(
        `/scans/${scanId}/duplicate-dirs?page=${page}&per_page=200`
      ),
    enabled: !!scanId,
  });
}
```

Also remove `DuplicateDirectory` from the type imports at the top of the file (line 4):
```tsx
// REMOVE DuplicateDirectory from this import:
import type {
  DuplicateDirectory, // REMOVE this line
  ...
} from "./types";
```

In `frontend/src/api/types.ts`, remove the `DuplicateDirectory` interface (lines 62-70):
```tsx
// REMOVE this entire interface:
export interface DuplicateDirectory {
  id: number;
  scan_id: number;
  group_id: string;
  path: string;
  file_count: number;
  total_size: number;
  is_original: boolean;
}
```

- [ ] **Step 2: Remove backend dead code**

In `backend/app/api/results.py`:

Remove `DuplicateDirectory` from the import on line 10:
```python
# Change FROM:
from app.models.duplicate import DuplicateDirectory, DuplicateFile
# TO:
from app.models.duplicate import DuplicateFile
```

Remove the entire `list_duplicate_dirs` endpoint function (lines 28-69):
```python
# REMOVE the entire function:
@router.get("/duplicate-dirs")
async def list_duplicate_dirs(
    ...
):
    ...
```

In `backend/app/tasks/scan_tasks.py`:

Remove the DuplicateDirectory import from line 13:
```python
# Change FROM:
from app.models.duplicate import DuplicateDirectory, DuplicateFile
# TO:
from app.models.duplicate import DuplicateFile
```

Remove the DuplicateDirectory population block (lines 628-664):
```python
# REMOVE everything from this comment through the logger.info line:
    # Populate DuplicateDirectory from >99% byte-similar pairs
    # This fills the "Exact Duplicates" tab
    dir_dup_records = []
    ...
    if dir_dup_records:
        ...
        logger.info("Populated %d exact duplicate directories for scan %d", len(dir_dup_records), scan_id)
```

Also remove the `delete` import from sqlalchemy if it's no longer used in that function. Check by searching for other uses of `delete(` in the file.

- [ ] **Step 3: Verify both frontend and backend compile**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

Run: `cd backend && python -c "from app.api.results import router; print('OK')" && python -c "from app.tasks.scan_tasks import run_scan; print('OK')"`
Expected: Both print "OK".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/results.ts frontend/src/api/types.ts backend/app/api/results.py backend/app/tasks/scan_tasks.py
git commit -m "chore: remove dead Exact Duplicates code (endpoint, hook, types, scan task logic)"
```

---

### Task 7: Fix Compare View Progressive Loading

**Files:**
- Modify: `frontend/src/pages/DirectoryCompare.tsx`

- [ ] **Step 1: Change the loading gate to only wait for `useCompare`**

In `frontend/src/pages/DirectoryCompare.tsx`, replace the loading check (lines 153-159):

```tsx
// REPLACE:
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading comparison...
      </div>
    );
  }

// WITH:
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading comparison...
      </div>
    );
  }
```

Add the `Loader2` import to the lucide-react imports (line 3-14):
```tsx
// Add Loader2 to existing lucide imports:
import {
  ArrowRight,
  ArrowLeft,
  Play,
  Bookmark,
  SkipForward,
  FolderTree,
  Files,
  FileText,
  AlertTriangle,
  Layers,
  Loader2, // ADD this
} from "lucide-react";
```

- [ ] **Step 2: Replace the tree panel to show a skeleton while tree-diff loads**

Find the `<PanelGroup>` tree section (lines 341-380). Replace the tree rendering inside the first `<Panel>` to handle the loading state for `useTreeDiff` separately:

Replace the `<ScrollArea>` content in the first panel (approximately lines 348-365):

```tsx
// REPLACE the ScrollArea contents:
              <ScrollArea className="h-[500px]">
                {treeData.length > 0 ? (
                  <Tree
                    data={treeData}
                    openByDefault={true}
                    width="100%"
                    height={500}
                    indent={20}
                    rowHeight={28}
                    overscanCount={10}
                  >
                    {TreeNode}
                  </Tree>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Loading tree...
                  </p>
                )}
              </ScrollArea>

// WITH:
              <ScrollArea className="h-[500px]">
                {treeData.length > 0 ? (
                  <Tree
                    data={treeData}
                    openByDefault={true}
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
```

- [ ] **Step 3: Verify in browser**

Navigate to a Compare view. Verify:
- Summary stats, action buttons, and warnings appear instantly (from DB data)
- Tree panel shows "Loading directory tree..." with spinner
- Tree populates when filesystem scan completes
- No blank screen at any point

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DirectoryCompare.tsx
git commit -m "fix: show Compare view DB data instantly while tree-diff loads progressively"
```

---

### Task 8: End-to-End Verification

- [ ] **Step 1: Start both servers**

```bash
cd backend && uvicorn app.main:app --reload --port 8080 &
cd frontend && npm run dev &
```

- [ ] **Step 2: Run a scan and verify the full workflow**

1. Navigate to a completed scan's results page
2. Verify only 3 tabs: Overview, Duplicate Groups, Similar Directories
3. Click "Similar Directories" button or tab → navigates to card view
4. Verify cards show:
   - Full, readable directory paths (no truncation)
   - Jaccard %, Type badge, shared files + size in stats bar
   - File counts, sizes, subset percentages per directory
5. Click "Mark as Original" on a directory → button turns green, floating bar appears
6. Tag another directory → floating bar updates count
7. Click "Apply Tags & Recalculate" → success message shows
8. Expand "Show differences" on a card → lazy-loads file data
   - Verdict banner shows (newer version / merge recommended / identical)
   - File list shows filenames + dates
   - "Load more" button works
9. Click a card → navigates to Compare view
10. Compare view shows stats/buttons instantly, tree loads progressively

- [ ] **Step 3: Frontend build check**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit any final fixes**

If any fixes were needed during verification, commit them:
```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
