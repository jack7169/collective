import { useQuery } from "@tanstack/react-query";
import { get } from "@/api/client";
import type { BrowseResult, SystemHealth } from "@/api/types";

export function useBrowse(path: string) {
  return useQuery({
    queryKey: ["browse", path],
    queryFn: () =>
      get<BrowseResult>(`/browse?path=${encodeURIComponent(path)}`),
    enabled: !!path,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: () => get<SystemHealth>("/system/health"),
    refetchInterval: 30_000,
  });
}

export function useScanners() {
  return useQuery({
    queryKey: ["system", "scanners"],
    queryFn: () =>
      get<Record<string, { installed: boolean; version: string | null }>>(
        "/system/scanners"
      ),
  });
}
