import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./client";
import type { Action, CreateActionRequest, PaginatedResponse } from "./types";

export function useActions(scanId?: string, status?: string) {
  const params = new URLSearchParams();
  if (scanId) params.set("scan_id", scanId);
  if (status) params.set("status", status);
  const qs = params.toString();

  return useQuery({
    queryKey: ["actions", scanId, status],
    queryFn: () =>
      get<PaginatedResponse<Action>>(`/actions${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateActionRequest) => post<Action>("/actions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useDryRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (actionId: string) =>
      post<Action>(`/actions/${actionId}/dry-run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useConfirmAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (actionId: string) =>
      post<Action>(`/actions/${actionId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}
