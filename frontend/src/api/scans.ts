import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, put } from "./client";
import type {
  Scan,
  CreateScanRequest,
  SavedScan,
  ScanStats,
  PaginatedResponse,
} from "./types";

export function useScans() {
  return useQuery({
    queryKey: ["scans"],
    queryFn: () => get<PaginatedResponse<Scan>>("/scans"),
    refetchInterval: 10_000,
  });
}

export function useScan(id: string | undefined) {
  return useQuery({
    queryKey: ["scans", id],
    queryFn: () => get<Scan>(`/scans/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const scan = query.state.data;
      if (!scan) return 5_000; // Not loaded yet, keep polling
      const active = ["pending", "running", "parsing", "analyzing", "interrupted"];
      if (active.includes(scan.status)) return 5_000;
      return false;
    },
  });
}

export function useCreateScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScanRequest) => post<Scan>("/scans", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useDeleteScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/scans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useCancelScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<void>(`/scans/${id}/cancel`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["scans", id] });
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useResumeScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<Scan>(`/scans/${id}/resume`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["scans", id] });
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useReanalyze() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, similarity_threshold, scan_depth }: {
      id: string;
      similarity_threshold?: number;
      scan_depth?: number;
    }) => post<Scan>(`/scans/${id}/reanalyze`, { similarity_threshold, scan_depth }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["scans", id] });
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useScanStats(id: string | undefined) {
  return useQuery({
    queryKey: ["scans", id, "stats"],
    queryFn: () => get<ScanStats>(`/scans/${id}/stats`),
    enabled: !!id,
  });
}

// --- Saved Scans ---

export function useSavedScans() {
  return useQuery({
    queryKey: ["saved-scans"],
    queryFn: () => get<SavedScan[]>("/saved-scans"),
  });
}

export function useSavedScan(id: number | undefined) {
  return useQuery({
    queryKey: ["saved-scans", id],
    queryFn: () => get<SavedScan>(`/saved-scans/${id}`),
    enabled: id != null,
  });
}

export function useCreateSavedScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<SavedScan>) =>
      post<SavedScan>("/saved-scans", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-scans"] }),
  });
}

export function useUpdateSavedScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SavedScan> & { id: number }) =>
      put<SavedScan>(`/saved-scans/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-scans"] }),
  });
}

export function useDeleteSavedScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del<void>(`/saved-scans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-scans"] }),
  });
}

export function useRunSavedScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post<Scan>(`/saved-scans/${id}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-scans"] });
      qc.invalidateQueries({ queryKey: ["scans"] });
    },
  });
}

export function useSaveFromScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId: number) =>
      post<SavedScan>(`/saved-scans/from-scan/${scanId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-scans"] }),
  });
}

export function useSavedScanRuns(id: number | undefined, page = 1) {
  return useQuery({
    queryKey: ["saved-scans", id, "runs", page],
    queryFn: () =>
      get<PaginatedResponse<Scan>>(`/saved-scans/${id}/runs?page=${page}`),
    enabled: id != null,
  });
}
