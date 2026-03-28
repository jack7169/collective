import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GitCompare,
  Filter,
  FolderOpen,
  Files,
  Shield,
  X,
  Check,
  Loader2,
} from "lucide-react";
import {
  useSimilarDirs,
  useTagOriginals,
  useTaggedOriginals,
} from "@/api/results";
import type { DirectorySimilarityFilters } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SimilarityBadge } from "@/components/common/SimilarityBadge";
import { PathPicker } from "@/components/scan/PathPicker";
import { formatBytes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortField = "similarity" | "size" | "files";
type SortOrder = "asc" | "desc";

const sortFieldToApi: Record<SortField, string> = {
  similarity: "jaccard_similarity",
  size: "shared_size",
  files: "shared_files",
};

const relationshipColors: Record<string, string> = {
  exact: "text-red-400 border-red-400/30",
  subset: "text-orange-400 border-orange-400/30",
  superset: "text-blue-400 border-blue-400/30",
  overlap: "text-yellow-400 border-yellow-400/30",
  structural_match: "text-purple-400 border-purple-400/30",
};

export function SimilarDirectories() {
  const { id } = useParams<{ id: string }>();
  const [minSimilarity, setMinSimilarity] = useState(30);
  const [sortBy, setSortBy] = useState<SortField>("size");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [relationship, setRelationship] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [showTagging, setShowTagging] = useState(false);

  // Tagging state
  const { data: tagData } = useTaggedOriginals(id);
  const tagMutation = useTagOriginals(id);
  const [taggedPaths, setTaggedPaths] = useState<string[]>([]);

  // Initialize tagged paths from server (once)
  const currentTags = tagData?.tagged_paths ?? [];
  const [tagsInitialized, setTagsInitialized] = useState(false);
  if (currentTags.length > 0 && !tagsInitialized) {
    setTaggedPaths(currentTags);
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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field)
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  const handleApplyTags = async () => {
    await tagMutation.mutateAsync(taggedPaths);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Similar Directories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Adjust the threshold slider to filter noise. Tag originals to
            classify keeper copies.
          </p>
        </div>
        <Button
          variant={showTagging ? "default" : "outline"}
          onClick={() => setShowTagging(!showTagging)}
        >
          <Shield className="h-4 w-4" />
          {showTagging ? "Hide Tagging" : "Tag Originals"}
        </Button>
      </div>

      {/* Post-scan tagging panel */}
      {showTagging && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Tag Original Directories
            </CardTitle>
            <CardDescription>
              Files under tagged paths are marked as "keeper" copies. Everything
              else with the same checksum becomes a duplicate. Recoverable space
              recalculates when you apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PathPicker
              selectedPaths={taggedPaths}
              onChange={setTaggedPaths}
            />

            {taggedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {taggedPaths.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-mono text-primary"
                  >
                    <Shield className="h-3 w-3" />
                    {p}
                    <button
                      onClick={() =>
                        setTaggedPaths(taggedPaths.filter((x) => x !== p))
                      }
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={handleApplyTags}
                disabled={tagMutation.isPending}
              >
                {tagMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recalculating...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Apply Tags & Recalculate
                  </>
                )}
              </Button>
              {tagMutation.isSuccess && (
                <span className="text-sm text-success">
                  {tagMutation.data.files_tagged_as_original} files tagged,{" "}
                  {formatBytes(tagMutation.data.space_recoverable)} recoverable
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">
              Filters
            </CardTitle>
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

      {/* Results table */}
      <Card>
        <CardContent className="pt-6">
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Directory A</TableHead>
                      <TableHead>Directory B</TableHead>
                      <TableHead
                        className="w-24 cursor-pointer select-none"
                        onClick={() => toggleSort("similarity")}
                      >
                        <div className="flex items-center gap-1">
                          Jaccard
                          <SortIcon field="similarity" />
                        </div>
                      </TableHead>
                      <TableHead className="w-20">A in B</TableHead>
                      <TableHead className="w-20">B in A</TableHead>
                      <TableHead
                        className="w-24 cursor-pointer select-none"
                        onClick={() => toggleSort("files")}
                      >
                        <div className="flex items-center gap-1">
                          Shared
                          <SortIcon field="files" />
                        </div>
                      </TableHead>
                      <TableHead
                        className="w-28 cursor-pointer select-none"
                        onClick={() => toggleSort("size")}
                      >
                        <div className="flex items-center gap-1">
                          Size
                          <SortIcon field="size" />
                        </div>
                      </TableHead>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((pair) => (
                      <TableRow key={pair.id} className="hover:bg-accent/50">
                        <TableCell>
                          <div>
                            <div className="font-mono text-xs truncate max-w-[200px]">
                              {pair.dir_a}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatNumber(pair.files_a)} files,{" "}
                              {formatBytes(pair.size_a)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-mono text-xs truncate max-w-[200px]">
                              {pair.dir_b}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatNumber(pair.files_b)} files,{" "}
                              {formatBytes(pair.size_b)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <SimilarityBadge value={pair.jaccard_similarity} />
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {pair.a_subset_pct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {pair.b_subset_pct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Files className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">
                              {formatNumber(pair.shared_files)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {formatBytes(pair.shared_size)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {pair.relationship && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs capitalize",
                                relationshipColors[pair.relationship] ?? ""
                              )}
                            >
                              {pair.relationship.replace("_", " ")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              to={`/scans/${id}/compare?a=${encodeURIComponent(pair.dir_a)}&b=${encodeURIComponent(pair.dir_b)}`}
                            >
                              <GitCompare className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {data.pages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
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
        </CardContent>
      </Card>
    </div>
  );
}
