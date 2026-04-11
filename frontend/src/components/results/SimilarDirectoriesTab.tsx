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
import {
  groupIntoHubs,
  buildAdjacency,
  getExplodedPeers,
} from "@/lib/groupHubs";
import { formatBytes, formatNumber } from "@/lib/format";
import type { PeerEntry } from "@/lib/groupHubs";

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

  const getExplodedForHub = useCallback(
    (hubDir: string): Map<string, PeerEntry[]> => {
      const map = new Map<string, PeerEntry[]>();
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
        <div className="flex flex-col gap-4">
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
