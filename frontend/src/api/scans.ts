import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "./client";
import type {
  Scan,
  CreateScanRequest,
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
      if (scan?.status === "running") return 5_000;
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

export function useScanStats(id: string | undefined) {
  return useQuery({
    queryKey: ["scans", id, "stats"],
    queryFn: () => get<ScanStats>(`/scans/${id}/stats`),
    enabled: !!id,
  });
}
