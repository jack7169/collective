import { useQuery, useMutation } from "@tanstack/react-query";
import { get, post } from "./client";
import type {
  DuplicateDirectory,
  DuplicateGroup,
  DirectorySimilarity,
  DirectorySimilarityFilters,
  DuplicateFile,
  CompareResult,
  PaginatedResponse,
  TreeDiffResult,
  FileOperation,
  FileOpResult,
  ScanSchedule,
} from "./types";

export function useDuplicateDirs(scanId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ["scans", scanId, "duplicate-dirs", page],
    queryFn: () =>
      get<PaginatedResponse<DuplicateDirectory>>(
        `/scans/${scanId}/duplicate-dirs?page=${page}&per_page=200`
      ),
    enabled: !!scanId,
  });
}

export function useSimilarDirs(
  scanId: string | undefined,
  filters: DirectorySimilarityFilters = {}
) {
  const params = new URLSearchParams();
  if (filters.min_similarity !== undefined)
    params.set("min_similarity", String(filters.min_similarity));
  if (filters.sort_by) params.set("sort_by", filters.sort_by);
  if (filters.sort_order) params.set("sort_order", filters.sort_order);
  if (filters.relationship) params.set("relationship", filters.relationship);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.per_page) params.set("per_page", String(filters.per_page));

  const qs = params.toString();
  return useQuery({
    queryKey: ["scans", scanId, "similar-dirs", filters],
    queryFn: () =>
      get<PaginatedResponse<DirectorySimilarity>>(
        `/scans/${scanId}/similar-dirs${qs ? `?${qs}` : ""}`
      ),
    enabled: !!scanId,
  });
}

export function useDuplicateGroups(
  scanId: string | undefined,
  page = 1,
  perPage = 20,
  sortBy = "size"
) {
  return useQuery({
    queryKey: ["scans", scanId, "duplicate-groups", page, perPage, sortBy],
    queryFn: () =>
      get<PaginatedResponse<DuplicateGroup>>(
        `/scans/${scanId}/duplicate-groups?page=${page}&per_page=${perPage}&sort_by=${sortBy}`
      ),
    enabled: !!scanId,
  });
}

export function useDuplicateFiles(scanId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ["scans", scanId, "duplicate-files", page],
    queryFn: () =>
      get<PaginatedResponse<DuplicateFile>>(
        `/scans/${scanId}/duplicate-files?page=${page}&per_page=50`
      ),
    enabled: !!scanId,
  });
}

export function useCompare(
  scanId: string | undefined,
  dirA: string | null,
  dirB: string | null
) {
  return useQuery({
    queryKey: ["scans", scanId, "compare", dirA, dirB],
    queryFn: () =>
      get<CompareResult>(
        `/compare?scan_id=${scanId}&dir_a=${encodeURIComponent(dirA!)}&dir_b=${encodeURIComponent(dirB!)}`
      ),
    enabled: !!scanId && !!dirA && !!dirB,
  });
}

export function useTreeDiff(dirA: string | null, dirB: string | null) {
  return useQuery({
    queryKey: ["tree-diff", dirA, dirB],
    queryFn: () =>
      post<TreeDiffResult>("/compare/tree-diff", { dir_a: dirA, dir_b: dirB }),
    enabled: !!dirA && !!dirB,
  });
}

export function useFileOperations() {
  return useMutation({
    mutationFn: (data: { operations: FileOperation[]; dry_run: boolean }) =>
      post<{ results: FileOpResult[]; dry_run: boolean }>(
        "/compare/file-ops",
        data
      ),
  });
}

export function useSchedules() {
  return useQuery({
    queryKey: ["schedules"],
    queryFn: () => get<ScanSchedule[]>("/scheduler/schedules"),
  });
}

export function useCreateSchedule() {
  return useMutation({
    mutationFn: (data: Omit<ScanSchedule, "id" | "last_run">) =>
      post<ScanSchedule>("/scheduler/schedules", data),
  });
}

// Post-scan tagging
export function useTagOriginals(scanId: string | undefined) {
  return useMutation({
    mutationFn: (originalPaths: string[]) =>
      post<{
        tagged_paths: string[];
        files_tagged_as_original: number;
        total_duplicates: number;
        space_recoverable: number;
      }>(`/scans/${scanId}/tag-originals`, {
        original_paths: originalPaths,
      }),
  });
}

export function useTaggedOriginals(scanId: string | undefined) {
  return useQuery({
    queryKey: ["scans", scanId, "tagged-originals"],
    queryFn: () =>
      get<{ tagged_paths: string[] }>(`/scans/${scanId}/tagged-originals`),
    enabled: !!scanId,
  });
}
