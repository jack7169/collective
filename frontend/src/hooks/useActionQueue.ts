/**
 * Action Queue — allows users to build up filesystem changes
 * and apply them in a single batch with a confirmation modal.
 *
 * Supports: move, copy, delete, reflink, hardlink, symlink, merge
 * Integrates with drag-and-drop for file/directory operations.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/api/client";

export interface QueuedAction {
  id: string;
  type: "move" | "copy" | "delete" | "reflink" | "hardlink" | "symlink" | "merge";
  sourcePath: string;
  destPath?: string;
  description: string;
  estimatedSize?: number;
}

export interface QueueExecutionResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    action: QueuedAction;
    status: "success" | "error" | "dry_run";
    message?: string;
  }>;
}

let nextId = 0;
function generateId() {
  return `action-${Date.now()}-${nextId++}`;
}

export function useActionQueue() {
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [lastResult, setLastResult] = useState<QueueExecutionResult | null>(null);
  const queryClient = useQueryClient();

  const addAction = useCallback((action: Omit<QueuedAction, "id">) => {
    setQueue((prev) => [...prev, { ...action, id: generateId() }]);
  }, []);

  const removeAction = useCallback((id: string) => {
    setQueue((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const reorderAction = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setLastResult(null);
  }, []);

  const executeMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      // Create actions via API
      const results: QueueExecutionResult["results"] = [];

      for (const action of queue) {
        try {
          const response = await post<{ id: string }>("/actions", {
            action_type: action.type,
            source_path: action.sourcePath,
            dest_path: action.destPath,
            notes: action.description,
          });

          if (dryRun) {
            // Run dry-run for this action
            const dryResult = await post<{ dry_run_output: string }>(
              `/actions/${response.id}/dry-run`,
              {}
            );
            results.push({
              action,
              status: "dry_run",
              message: dryResult.dry_run_output,
            });
          } else {
            // Confirm and execute
            await post(`/actions/${response.id}/confirm`, {});
            results.push({ action, status: "success" });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({ action, status: "error", message });
        }
      }

      const result: QueueExecutionResult = {
        total: queue.length,
        succeeded: results.filter((r) => r.status === "success").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      };

      return result;
    },
    onSuccess: (result) => {
      setLastResult(result);
      if (result.failed === 0 && result.results.every((r) => r.status === "success")) {
        setQueue([]);
      }
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });

  const executeQueue = useCallback(
    (dryRun: boolean = false) => executeMutation.mutate(dryRun),
    [executeMutation]
  );

  return {
    queue,
    addAction,
    removeAction,
    reorderAction,
    clearQueue,
    executeQueue,
    isExecuting: executeMutation.isPending,
    lastResult,
    totalEstimatedSize: queue.reduce((sum, a) => sum + (a.estimatedSize ?? 0), 0),
  };
}
