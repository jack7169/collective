import { useState, useCallback } from "react";
import { Layers, Loader2, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDuplicateGroups } from "@/api/results";
import { post } from "@/api/client";
import { useKeeperSelection } from "@/hooks/useKeeperSelection";
import { Button } from "@/components/ui/button";
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

  const suggestMutation = useMutation({
    mutationFn: (
      decisions: Array<{ group_checksum: string; kept_file_id: number }>
    ) =>
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

  const handleSetKeeper = useCallback(
    (checksum: string, fileId: number) => {
      selection.setKeeper(checksum, fileId);

      const allDecisions: Array<{
        group_checksum: string;
        kept_file_id: number;
      }> = [];
      for (const group of groups) {
        const existing = selection.keepers.get(group.checksum);
        if (existing != null) {
          allDecisions.push({
            group_checksum: group.checksum,
            kept_file_id: existing,
          });
        }
      }
      if (!allDecisions.some((d) => d.group_checksum === checksum)) {
        allDecisions.push({ group_checksum: checksum, kept_file_id: fileId });
      }

      if (allDecisions.length >= 3) {
        suggestMutation.mutate(allDecisions);
      }
    },
    [groups, selection, suggestMutation]
  );

  const executeMutation = useMutation({
    mutationFn: async () => {
      for (const decision of selection.decisions) {
        for (const path of decision.deletePaths) {
          const action = await post<{ id: number }>("/actions", {
            scan_id: Number(scanId),
            action_type: "delete",
            source_path: path,
            notes: `Keep: ${decision.keeperPath}`,
          });
          await post(`/actions/${action.id}/confirm`, {});
        }
      }
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
