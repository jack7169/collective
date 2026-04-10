import { Shield, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

interface TagFloatingBarProps {
  taggedPaths: Set<string>;
  onClear: () => void;
  onApply: () => void;
  isPending: boolean;
  result?: {
    files_tagged_as_original: number;
    space_recoverable: number;
  } | null;
}

export function TagFloatingBar({
  taggedPaths,
  onClear,
  onApply,
  isPending,
  result,
}: TagFloatingBarProps) {
  if (taggedPaths.size === 0 && !result) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4">
      <div className="rounded-lg border border-success/30 bg-card/95 backdrop-blur-sm shadow-lg px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="h-4 w-4 text-success shrink-0" />
          {result ? (
            <span className="text-sm text-success">
              {result.files_tagged_as_original} files tagged ·{" "}
              {formatBytes(result.space_recoverable)} recoverable
            </span>
          ) : (
            <span className="text-sm text-success font-medium">
              {taggedPaths.size} director
              {taggedPaths.size === 1 ? "y" : "ies"} tagged as original
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onClear}
            disabled={isPending}
          >
            <X className="h-3.5 w-3.5" />
            Clear All
          </Button>
          <Button
            size="sm"
            className="text-xs bg-success/20 border-success/40 text-success hover:bg-success/30"
            onClick={onApply}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Recalculating...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Apply Tags & Recalculate
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
