import { useState, useCallback, useMemo } from "react";
import type { DuplicateGroup, DuplicateFileInGroup } from "@/api/types";

export interface KeeperDecision {
  checksum: string;
  keeperFileId: number;
  keeperPath: string;
  deletePaths: string[];
  reclaimableBytes: number;
}

export interface SuggestedKeeper {
  groupChecksum: string;
  suggestedFileId: number;
  confidence: number;
  reason: string;
}

export function useKeeperSelection(groups: DuplicateGroup[]) {
  const [keepers, setKeepers] = useState<Map<string, number>>(new Map());
  const [suggestions, setSuggestions] = useState<Map<string, SuggestedKeeper>>(new Map());

  const filesById = useMemo(() => {
    const map = new Map<number, { file: DuplicateFileInGroup; group: DuplicateGroup }>();
    for (const group of groups) {
      for (const file of group.files) {
        map.set(file.id, { file, group });
      }
    }
    return map;
  }, [groups]);

  const setKeeper = useCallback((checksum: string, fileId: number) => {
    setKeepers((prev) => {
      const next = new Map(prev);
      next.set(checksum, fileId);
      return next;
    });
  }, []);

  const clearKeeper = useCallback((checksum: string) => {
    setKeepers((prev) => {
      const next = new Map(prev);
      next.delete(checksum);
      return next;
    });
  }, []);

  const acceptSuggestion = useCallback((checksum: string) => {
    const suggestion = suggestions.get(checksum);
    if (suggestion) {
      setKeeper(checksum, suggestion.suggestedFileId);
    }
  }, [suggestions, setKeeper]);

  const acceptAllSuggestions = useCallback(() => {
    setKeepers((prev) => {
      const next = new Map(prev);
      for (const [checksum, suggestion] of suggestions) {
        if (!next.has(checksum)) {
          next.set(checksum, suggestion.suggestedFileId);
        }
      }
      return next;
    });
  }, [suggestions]);

  const updateSuggestions = useCallback((newSuggestions: SuggestedKeeper[]) => {
    const map = new Map<string, SuggestedKeeper>();
    for (const s of newSuggestions) {
      if (!keepers.has(s.groupChecksum)) {
        map.set(s.groupChecksum, s);
      }
    }
    setSuggestions(map);
  }, [keepers]);

  const decisions = useMemo((): KeeperDecision[] => {
    const result: KeeperDecision[] = [];
    for (const group of groups) {
      const keeperId = keepers.get(group.checksum);
      if (keeperId == null) continue;
      const keeper = group.files.find((f) => f.id === keeperId);
      if (!keeper) continue;
      const deleteFiles = group.files.filter((f) => f.id !== keeperId);
      result.push({
        checksum: group.checksum,
        keeperFileId: keeperId,
        keeperPath: keeper.path,
        deletePaths: deleteFiles.map((f) => f.path),
        reclaimableBytes: deleteFiles.reduce((sum, f) => sum + f.size, 0),
      });
    }
    return result;
  }, [groups, keepers]);

  const resolvedCount = keepers.size;

  const totalReclaimable = useMemo(
    () => decisions.reduce((sum, d) => sum + d.reclaimableBytes, 0),
    [decisions]
  );

  const totalDeleteFiles = useMemo(
    () => decisions.reduce((sum, d) => sum + d.deletePaths.length, 0),
    [decisions]
  );

  const unresolvedSuggestionCount = useMemo(() => {
    let count = 0;
    for (const checksum of suggestions.keys()) {
      if (!keepers.has(checksum)) count++;
    }
    return count;
  }, [suggestions, keepers]);

  return {
    keepers,
    suggestions,
    setKeeper,
    clearKeeper,
    acceptSuggestion,
    acceptAllSuggestions,
    updateSuggestions,
    decisions,
    resolvedCount,
    totalReclaimable,
    totalDeleteFiles,
    unresolvedSuggestionCount,
  };
}
