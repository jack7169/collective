import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put, del } from "./client";
import { ApiError } from "./client";

export interface SandboxSessionResponse {
  id: number;
  scan_id: number;
  name: string | null;
  commands: unknown[];
  cursor: number;
  created_at: string;
  updated_at: string;
}

function sandboxKey(scanId: number | string) {
  return ["sandbox", String(scanId)];
}

export function useSandboxSessionQuery(scanId: number | string | undefined) {
  return useQuery({
    queryKey: sandboxKey(scanId ?? ""),
    queryFn: async () => {
      try {
        return await get<SandboxSessionResponse>(`/scans/${scanId}/sandbox`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return undefined;
        }
        throw err;
      }
    },
    enabled: scanId != null,
    retry: false,
    staleTime: Infinity,
  });
}

export function useCreateSandboxSession(scanId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<SandboxSessionResponse>(`/scans/${scanId}/sandbox`),
    onSuccess: (data) => {
      qc.setQueryData(sandboxKey(scanId), data);
    },
  });
}

export function useSaveSandboxSession() {
  return useMutation({
    mutationFn: ({
      sessionId,
      ...body
    }: {
      sessionId: number;
      name?: string | null;
      commands?: unknown[];
      cursor?: number;
    }) => put<SandboxSessionResponse>(`/sandbox/${sessionId}`, body),
  });
}

export function useDeleteSandboxSession(scanId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) =>
      del<void>(`/sandbox/${sessionId}`),
    onSuccess: () => {
      qc.setQueryData(sandboxKey(scanId), undefined);
    },
  });
}

export function useCommitSandboxSession() {
  return useMutation({
    mutationFn: (sessionId: number) =>
      post<{ status: string; session_id: number }>(
        `/sandbox/${sessionId}/commit`
      ),
  });
}
