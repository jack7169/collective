import { Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CommitPhase = "dry-run" | "executing" | "completed" | "rolled-back" | "failed-partial";

interface CommitProgressOverlayProps {
  phase: CommitPhase;
  error?: string;
  rollbackError?: string;
  onClose: () => void;
}

const phaseConfig: Record<
  CommitPhase,
  { label: string; description: string; active: boolean }
> = {
  "dry-run": {
    label: "Validating...",
    description: "Running dry-run to verify operations before applying.",
    active: true,
  },
  executing: {
    label: "Committing to Disk",
    description: "Applying all planned operations. Please wait.",
    active: true,
  },
  completed: {
    label: "Commit Complete",
    description: "All operations completed successfully.",
    active: false,
  },
  "rolled-back": {
    label: "Rolled Back",
    description: "An error occurred. Changes have been rolled back.",
    active: false,
  },
  "failed-partial": {
    label: "Partial Failure",
    description: "Some operations failed. Manual review may be required.",
    active: false,
  },
};

export function CommitProgressOverlay({
  phase,
  error,
  rollbackError,
  onClose,
}: CommitProgressOverlayProps) {
  const config = phaseConfig[phase];
  const isActive = config.active;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
        {/* Icon */}
        <div className="flex justify-center mb-5">
          {isActive && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {phase === "completed" && (
            <CheckCircle className="h-12 w-12 text-green-500" />
          )}
          {phase === "rolled-back" && (
            <AlertTriangle className="h-12 w-12 text-amber-500" />
          )}
          {phase === "failed-partial" && (
            <XCircle className="h-12 w-12 text-destructive" />
          )}
        </div>

        {/* Title + description */}
        <h2 className="text-xl font-semibold text-center mb-1">
          {config.label}
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-5">
          {config.description}
        </p>

        {/* Error box */}
        {error && (
          <div
            className={cn(
              "rounded-lg border p-3 mb-3 text-sm",
              phase === "rolled-back"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <p className="font-medium mb-0.5">Error</p>
            <p className="break-words">{error}</p>
          </div>
        )}

        {/* Rollback error box */}
        {rollbackError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive p-3 mb-3 text-sm">
            <p className="font-medium mb-0.5">Rollback Error</p>
            <p className="break-words">{rollbackError}</p>
          </div>
        )}

        {/* Close button — only when not active */}
        {!isActive && (
          <div className="flex justify-center mt-2">
            <Button
              variant={phase === "completed" ? "default" : "outline"}
              onClick={onClose}
            >
              {phase === "completed" ? "Done" : "Close"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
