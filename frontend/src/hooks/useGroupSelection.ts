import { useState, useCallback, useMemo } from "react";
import type { DuplicateGroup, DuplicateFileInGroup } from "@/api/types";

export function useGroupSelection(groups: DuplicateGroup[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Build lookup: file ID -> file object
  const filesById = useMemo(() => {
    const map = new Map<number, DuplicateFileInGroup>();
    for (const group of groups) {
      for (const file of group.files) {
        map.set(file.id, file);
      }
    }
    return map;
  }, [groups]);

  const toggleFile = useCallback((fileId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const selectAllDuplicatesInGroup = useCallback((group: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const file of group.files) {
        if (!file.is_original) next.add(file.id);
      }
      return next;
    });
  }, []);

  const selectAllExceptOldest = useCallback((group: DuplicateGroup) => {
    const sorted = [...group.files].sort(
      (a, b) => (a.mtime ?? 0) - (b.mtime ?? 0)
    );
    setSelected((prev) => {
      const next = new Set(prev);
      // Keep the oldest (first after sort), select the rest
      sorted.forEach((file, i) => {
        if (i === 0) {
          next.delete(file.id);
        } else {
          next.add(file.id);
        }
      });
      return next;
    });
  }, []);

  const selectAllExceptNewest = useCallback((group: DuplicateGroup) => {
    const sorted = [...group.files].sort(
      (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)
    );
    setSelected((prev) => {
      const next = new Set(prev);
      // Keep the newest (first after sort), select the rest
      sorted.forEach((file, i) => {
        if (i === 0) {
          next.delete(file.id);
        } else {
          next.add(file.id);
        }
      });
      return next;
    });
  }, []);

  const selectAllDuplicates = useCallback((groups: DuplicateGroup[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const group of groups) {
        for (const file of group.files) {
          if (!file.is_original) next.add(file.id);
        }
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const clearGroup = useCallback((group: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const file of group.files) {
        next.delete(file.id);
      }
      return next;
    });
  }, []);

  const selectedCount = selected.size;

  const selectedTotalSize = useMemo(() => {
    let total = 0;
    for (const id of selected) {
      const file = filesById.get(id);
      if (file) total += file.size;
    }
    return total;
  }, [selected, filesById]);

  const selectedFiles = useMemo(() => {
    const files: DuplicateFileInGroup[] = [];
    for (const id of selected) {
      const file = filesById.get(id);
      if (file) files.push(file);
    }
    return files;
  }, [selected, filesById]);

  return {
    selected,
    toggleFile,
    selectAllDuplicatesInGroup,
    selectAllExceptOldest,
    selectAllExceptNewest,
    selectAllDuplicates,
    clearSelection,
    clearGroup,
    selectedCount,
    selectedTotalSize,
    selectedFiles,
  };
}
