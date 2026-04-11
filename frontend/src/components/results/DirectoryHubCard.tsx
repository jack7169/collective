import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ChevronDown } from "lucide-react";
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
  const [showDropdown, setShowDropdown] = useState(false);

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
          "p-5 border-b border-border",
          isTagged && "bg-success/5"
        )}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-foreground break-all leading-relaxed">
              {hub.directory}
            </div>
            <div className="flex gap-5 mt-3 text-xs text-muted-foreground">
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
      <div className="px-5 py-3 text-xs text-muted-foreground border-b border-border">
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

          return (
            <div
              key={peer.directory}
              className="group/peer border-b border-border last:border-b-0"
            >
              {/* Main peer row */}
              <div
                className="px-5 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => handlePeerClick(peer)}
                title={
                  peer.uniqueInHub === 0 && peer.uniqueInPeer === 0
                    ? "Identical — no unique files on either side"
                    : undefined
                }
              >
                <div className="flex items-center gap-3">
                  <SimilarityBadge value={peer.similarity} />
                  {peer.relationship && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs capitalize",
                        getRelationshipBgColor(peer.relationship)
                      )}
                    >
                      {peer.relationship.replace("_", " ")}
                    </Badge>
                  )}
                  {peerExploded.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {peerExploded.length} exploded connection{peerExploded.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                  <span className="font-mono text-xs text-foreground break-all flex-1">
                    {peer.directory}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatBytes(peer.sharedSize)} shared
                  </span>
                  <span className="text-muted-foreground text-xs">→</span>
                </div>
                <div className="flex gap-5 mt-2 ml-16 text-xs text-muted-foreground">
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

            </div>
          );
        })}
      </div>
    </div>
  );
}
