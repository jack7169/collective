import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put } from "./client";
import type { AssimilateSession, AssimilatePreview, StagedOperation } from "./types";

export function useAssimilateSessions(scanId?: number) {
  const params = scanId ? `?scan_id=${scanId}` : "";
  return useQuery({
    queryKey: ["assimilate-sessions", scanId],
    queryFn: () => get<AssimilateSession[]>(`/assimilate/sessions${params}`),
  });
}

export function useAssimilateSession(sessionId: number | undefined) {
  return useQuery({
    queryKey: ["assimilate-sessions", sessionId],
    queryFn: () => get<AssimilateSession>(`/assimilate/sessions/${sessionId}`),
    enabled: sessionId != null,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (s?.status === "committing") return 2000;
      return false;
    },
  });
}

export function useCreateAssimilateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { scan_id: number; name: string; dir_a: string; dir_b: string }) =>
      post<AssimilateSession>("/assimilate/sessions", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assimilate-sessions"] });
    },
  });
}

export function useStageOperations(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operations: StagedOperation[]) =>
      put<AssimilateSession>(`/assimilate/sessions/${sessionId}/stage`, { operations }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assimilate-sessions", sessionId] });
    },
  });
}

export function usePreviewCommit(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<AssimilatePreview>(`/assimilate/sessions/${sessionId}/preview`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assimilate-sessions", sessionId] });
    },
  });
}

export function useAcknowledgeWarnings(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (checksums: string[]) =>
      post<AssimilateSession>(`/assimilate/sessions/${sessionId}/acknowledge`, { checksums }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assimilate-sessions", sessionId] });
    },
  });
}

export function useCommitSession(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<AssimilateSession>(`/assimilate/sessions/${sessionId}/commit`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assimilate-sessions", sessionId] });
    },
  });
}
