import { Undo2, Redo2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSandbox } from "@/hooks/useSandboxSession";
import { useCommitSandboxSession } from "@/api/sandbox";
import { commandLabel } from "@/lib/sandboxCommands";

export function SessionSummaryBar() {
  const session = useSandbox();
  const commitMutation = useCommitSandboxSession();

  if (!session.hasChanges) {
    return null;
  }

  const lastCommand =
    session.cursor > 0 ? session.commands[session.cursor - 1] : null;
  const lastLabel = lastCommand != null ? commandLabel(lastCommand) : "";

  function handleDiscard() {
    if (confirm("Discard all session changes? This cannot be undone.")) {
      session.discard();
    }
  }

  function handleCommit() {
    if (session.sessionId == null) return;
    if (
      confirm(
        "Commit all changes to disk? This will apply your session decisions permanently.",
      )
    ) {
      commitMutation.mutate(session.sessionId);
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left side: undo/redo + change summary */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={session.undo}
            disabled={!session.canUndo}
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={session.redo}
            disabled={!session.canRedo}
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {session.commandCount} change{session.commandCount !== 1 ? "s" : ""}
            {lastLabel ? ` — ${lastLabel}` : ""}
          </span>
        </div>

        {/* Right side: discard + commit */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDiscard}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Discard
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleCommit}
            disabled={commitMutation.isPending || session.sessionId == null}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {commitMutation.isPending ? "Committing..." : "Commit to Disk"}
          </Button>
        </div>
      </div>
    </div>
  );
}
