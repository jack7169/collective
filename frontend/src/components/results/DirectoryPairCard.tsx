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
      `/scans/${scanId}/assimilate?a=${encodeURIComponent(pair.dir_a)}&b=${encodeURIComponent(pair.dir_b)}`
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
          Click to assimilate →
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
              {pair.dir_a.split("/").pop()}
            </span>
            {aIsTagged && (
              <span className="text-[9px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded">
                ORIGINAL
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-foreground break-all leading-relaxed">
            {pair.dir_a}
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
            <span>{formatNumber(pair.files_a)} files</span>
            <span>{formatBytes(pair.size_a)}</span>
            <span>{pair.a_subset_pct.toFixed(1)}% overlap</span>
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
              {pair.dir_b.split("/").pop()}
            </span>
            {bIsTagged && (
              <span className="text-[9px] font-semibold text-success bg-success/15 px-2 py-0.5 rounded">
                ORIGINAL
              </span>
            )}
          </div>
          <div className="font-mono text-xs text-foreground break-all leading-relaxed">
            {pair.dir_b}
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
            <span>{formatNumber(pair.files_b)} files</span>
            <span>{formatBytes(pair.size_b)}</span>
            <span>{pair.b_subset_pct.toFixed(1)}% overlap</span>
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
