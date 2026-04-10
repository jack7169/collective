import { useState, useCallback } from "react";
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

interface SimilarDirectoriesTabProps {
  scanId: string;
}

export function SimilarDirectoriesTab({ scanId }: SimilarDirectoriesTabProps) {
  const [minSimilarity, setMinSimilarity] = useState(30);
  const [sortBy, setSortBy] = useState<SortField>("size");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [relationship, setRelationship] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Tag state — using Set for O(1) lookups across all cards
  const { data: tagData } = useTaggedOriginals(scanId);
  const tagMutation = useTagOriginals(scanId);
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

  const { data, isLoading } = useSimilarDirs(scanId, filters);

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
                scanId={scanId}
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
