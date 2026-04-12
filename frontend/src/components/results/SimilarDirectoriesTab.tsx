import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  useSimilarDirs,
} from "@/api/results";
import { useSandbox } from "@/hooks/useSandboxSession";
import type { DirectorySimilarityFilters } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  highlightDirectory?: string | null;
  onHighlightClear?: () => void;
}

export function SimilarDirectoriesTab({ scanId, highlightDirectory, onHighlightClear }: SimilarDirectoriesTabProps) {
  const [sortBy, setSortBy] = useState<SortField>("reclaimable");
  const [relationship, setRelationship] = useState<string>("all");
  const session = useSandbox();

  // Fetch ALL pairs at once for client-side hub grouping
  const filters: DirectorySimilarityFilters = {
    min_similarity: 10,
    sort_by: "impact",
    sort_order: "desc",
    relationship: relationship === "all" ? undefined : relationship,
    per_page: 500,
  };

  const { data, isLoading } = useSimilarDirs(scanId, filters);

  // Tag & Move dialog state
  const [tagMoveHub, setTagMoveHub] = useState<string | null>(null);

  // Group pairs into hubs (re-runs when promotions change)
  const pairs = data?.items ?? [];
  const hubs = useMemo(() => {
    const prefs = session.derived.promotedHubs;
    const grouped = groupIntoHubs(pairs, prefs.size > 0 ? prefs : undefined);
    if (sortBy === "peers") {
      grouped.sort((a, b) => b.peers.length - a.peers.length);
    } else if (sortBy === "size") {
      grouped.sort((a, b) => b.totalSize - a.totalSize);
    }
    // "reclaimable" is the default from groupIntoHubs
    return grouped;
  }, [pairs, sortBy, session.derived.promotedHubs]);

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

  const handleSkipMove = (hubDir: string) => {
    session.execute({ type: "tag-original", directory: hubDir });
  };

  const handlePromotePeer = (peerDir: string) => {
    session.execute({ type: "promote-hub", peerDir });
  };

  // Scroll + highlight when a directory is targeted from another tab
  const hubListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightDirectory || !hubListRef.current) return;

    // Find the hub that contains this directory (as hub or as a peer)
    const targetHub = hubs.find(
      (h) =>
        highlightDirectory.startsWith(h.directory) ||
        h.peers.some((p) => highlightDirectory.startsWith(p.directory))
    );
    if (!targetHub) return;

    // Find the DOM element and scroll to it
    const el = hubListRef.current.querySelector(
      `[data-hub-directory="${CSS.escape(targetHub.directory)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
      // Remove highlight after 3 seconds
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        onHighlightClear?.();
      }, 3000);
    }
  }, [highlightDirectory, hubs, onHighlightClear]);

  const tagMoveHubData = hubs.find((h) => h.directory === tagMoveHub);
  const totalReclaimable = hubs.reduce((s, h) => s + h.totalReclaimable, 0);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortField)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reclaimable">Sort by Reclaimable</SelectItem>
              <SelectItem value="peers">Sort by Peer Count</SelectItem>
              <SelectItem value="size">Sort by Size</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={relationship}
            onValueChange={setRelationship}
          >
            <SelectTrigger className="w-28">
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

        {data && (
          <span className="text-sm text-muted-foreground">
            {formatNumber(hubs.length)} hubs ·{" "}
            <span className="text-destructive font-medium">
              ~{formatBytes(totalReclaimable)} reclaimable
            </span>
          </span>
        )}
      </div>

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
            No similar directories found
          </p>
        </div>
      ) : (
        <div ref={hubListRef} className="flex flex-col gap-4">
          {hubs.map((hub) => (
            <div key={hub.directory} data-hub-directory={hub.directory} className="rounded-lg transition-all duration-300">
            <DirectoryHubCard
              hub={hub}
              scanId={scanId}
              isTagged={session.derived.taggedOriginals.has(hub.directory)}
              onTagMove={handleTagMove}
              onSkipMove={handleSkipMove}
              onPromotePeer={handlePromotePeer}
              explodedPeers={getExplodedForHub(hub.directory)}
            />
            </div>
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
