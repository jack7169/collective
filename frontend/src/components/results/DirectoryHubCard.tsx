import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ChevronDown, Network } from "lucide-react";
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
                          <SimilarityBadge value={ep.similarity} />
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
