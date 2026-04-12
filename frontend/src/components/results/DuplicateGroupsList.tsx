import { useState, useCallback, useRef, useMemo } from "react";
import { Layers, Loader2, Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useDuplicateGroups } from "@/api/results";
import { post } from "@/api/client";
import { useSandbox } from "@/hooks/useSandboxSession";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DuplicateGroupCard } from "./DuplicateGroupCard";
import type { SuggestedKeeper } from "@/api/types";
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
  const { data, isLoading } = useDuplicateGroups(scanId, page, 20, sortBy);
  const groups = data?.items ?? [];
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const session = useSandbox();

  // Local suggestions state — only acceptance goes through the sandbox
  const [suggestions, setSuggestions] = useState<
    Map<string, SuggestedKeeper>
  >(new Map());

  // Auto-resolution: derive keeper from cross-tab directory tagging
  const autoResolved = useMemo(() => {
    const result = new Map<string, { fileId: number; reason: string }>();
    if (!groups) return result;

    const tagged = session.derived.taggedOriginals;
    const doomed = session.derived.markedForDelete;
    if (tagged.size === 0 && doomed.size === 0) return result;

    for (const group of groups) {
      if (session.derived.keepers.has(group.checksum)) continue;

      let candidateId: number | null = null;
      let candidateDir = "";
      let candidateCount = 0;

      for (const file of group.files) {
        const inOriginal = [...tagged].some((d) => file.path.startsWith(d + "/"));
        if (inOriginal) {
          candidateId = file.id;
          candidateDir = [...tagged].find((d) => file.path.startsWith(d + "/"))!;
          candidateCount++;
        }
      }

      if (candidateCount === 1 && candidateId !== null) {
        const dirName = candidateDir.split("/").pop() || candidateDir;
        result.set(group.checksum, {
          fileId: candidateId,
          reason: `Keeper is in tagged original: ${dirName}`,
        });
      }
    }
    return result;
  }, [groups, session.derived.taggedOriginals, session.derived.markedForDelete, session.derived.keepers]);

  // Helper: return manual keeper if set, otherwise auto-resolved keeper
  const getEffectiveKeeper = (checksum: string): number | undefined => {
    return session.derived.keepers.get(checksum) ?? autoResolved.get(checksum)?.fileId;
  };

  // Compute stats from sandbox-derived keepers (manual + auto)
  const keeperStats = useMemo(() => {
    let manualCount = 0;
    let autoCount = 0;
    let totalReclaimable = 0;
    let totalDeleteFiles = 0;
    if (!groups) return { manualCount, autoCount, resolvedCount: 0, totalReclaimable, totalDeleteFiles };

    for (const group of groups) {
      const manualKeeper = session.derived.keepers.get(group.checksum);
      const autoKeeper = autoResolved.get(group.checksum)?.fileId;
      const effectiveKeeper = manualKeeper ?? autoKeeper;

      if (effectiveKeeper != null) {
        if (manualKeeper != null) manualCount++;
        else autoCount++;
        for (const file of group.files) {
          if (file.id !== effectiveKeeper) {
            totalDeleteFiles++;
            totalReclaimable += file.size;
          }
        }
      }
    }
    return { manualCount, autoCount, resolvedCount: manualCount + autoCount, totalReclaimable, totalDeleteFiles };
  }, [groups, session.derived.keepers, autoResolved]);

  // Count suggestions that haven't been resolved yet
  const unresolvedSuggestionCount = useMemo(() => {
    let count = 0;
    for (const checksum of suggestions.keys()) {
      if (!session.derived.keepers.has(checksum)) count++;
    }
    return count;
  }, [suggestions, session.derived.keepers]);

  const suggestMutation = useMutation({
    mutationFn: (
      decisions: Array<{ group_checksum: string; kept_file_id: number }>
    ) =>
      post<SuggestKeepersResponse>(`/scans/${scanId}/suggest-keepers`, {
        decisions,
      }),
    onSuccess: (data) => {
      const map = new Map<string, SuggestedKeeper>();
      for (const s of data.suggestions) {
        if (!session.derived.keepers.has(s.group_checksum)) {
          map.set(s.group_checksum, {
            groupChecksum: s.group_checksum,
            suggestedFileId: s.suggested_file_id,
            confidence: s.confidence,
            reason: s.reason,
          });
        }
      }
      setSuggestions(map);
    },
  });

  const handleSetKeeper = useCallback(
    (checksum: string, fileId: number) => {
      session.execute({ type: "set-keeper", checksum, fileId });

      const allDecisions: Array<{
        group_checksum: string;
        kept_file_id: number;
      }> = [];
      for (const group of groups) {
        const existing = session.derived.keepers.get(group.checksum);
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
        if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = setTimeout(() => {
          suggestMutation.mutate(allDecisions);
        }, 500);
      }
    },
    [groups, session, suggestMutation]
  );

  const handleClearKeeper = useCallback(
    (checksum: string) => {
      session.execute({ type: "clear-keeper", checksum });
    },
    [session]
  );

  const handleAcceptSuggestion = useCallback(
    (checksum: string) => {
      const suggestion = suggestions.get(checksum);
      if (suggestion) {
        session.execute({
          type: "accept-suggestion",
          checksum,
          fileId: suggestion.suggestedFileId,
        });
      }
    },
    [suggestions, session]
  );

  const handleAcceptAllSuggestions = useCallback(() => {
    const entries: Array<{ checksum: string; fileId: number }> = [];
    for (const [checksum, suggestion] of suggestions) {
      if (!session.derived.keepers.has(checksum)) {
        entries.push({ checksum, fileId: suggestion.suggestedFileId });
      }
    }
    if (entries.length > 0) {
      session.execute({ type: "accept-all-suggestions", suggestions: entries });
    }
  }, [suggestions, session]);

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
            {keeperStats.resolvedCount} of {formatNumber(data.total)} groups
            resolved
            {keeperStats.autoCount > 0 && (
              <span className="text-success ml-1">
                ({keeperStats.autoCount} auto, {keeperStats.manualCount} manual)
              </span>
            )}
            {keeperStats.totalReclaimable > 0 && (
              <>
                {" · "}
                <span className="text-destructive font-medium">
                  {formatBytes(keeperStats.totalReclaimable)} reclaimable
                </span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {unresolvedSuggestionCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAcceptAllSuggestions}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Accept All Suggestions ({unresolvedSuggestionCount})
            </Button>
          )}
        </div>
      </div>

      {/* Group cards */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const effectiveKeeper = getEffectiveKeeper(group.checksum);
          const auto = autoResolved.get(group.checksum);

          const fileStatuses = new Map<number, "original" | "doomed" | "neutral">();
          for (const file of group.files) {
            const inOriginal = [...session.derived.taggedOriginals].some((d) => file.path.startsWith(d + "/"));
            const inDoomed = [...session.derived.markedForDelete.keys()].some((d) => file.path.startsWith(d + "/"));
            fileStatuses.set(file.id, inOriginal ? "original" : inDoomed ? "doomed" : "neutral");
          }

          return (
            <DuplicateGroupCard
              key={group.checksum}
              group={group}
              keeperFileId={effectiveKeeper}
              suggestion={suggestions.get(group.checksum)}
              autoResolution={auto}
              fileStatuses={fileStatuses}
              onSetKeeper={handleSetKeeper}
              onClearKeeper={handleClearKeeper}
              onAcceptSuggestion={handleAcceptSuggestion}
            />
          );
        })}
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

    </div>
  );
}
