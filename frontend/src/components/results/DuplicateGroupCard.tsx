import { Shield, Check, CheckCircle, AlertTriangle, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/api/types";
import type { SuggestedKeeper } from "@/api/types";

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  keeperFileId: number | undefined;
  suggestion: SuggestedKeeper | undefined;
  autoResolution?: { fileId: number; reason: string };
  fileStatuses?: Map<number, "original" | "doomed" | "neutral">;
  onSetKeeper: (checksum: string, fileId: number) => void;
  onClearKeeper: (checksum: string) => void;
  onAcceptSuggestion: (checksum: string) => void;
  onViewParentDirectory?: (directory: string) => void;
}

export function DuplicateGroupCard({
  group,
  keeperFileId,
  suggestion,
  autoResolution,
  fileStatuses,
  onSetKeeper,
  onClearKeeper,
  onAcceptSuggestion,
  onViewParentDirectory,
}: DuplicateGroupCardProps) {
  const isResolved = keeperFileId != null;
  const isAutoResolved = autoResolution != null && keeperFileId === autoResolution.fileId;
  const reclaimable = isResolved
    ? group.files
        .filter((f) => f.id !== keeperFileId)
        .reduce((sum, f) => sum + f.size, 0)
    : 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        isResolved
          ? "border-success/30"
          : suggestion
            ? "border-primary/20"
            : "border-border"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {group.file_count} copies
          </Badge>
          <span className="text-sm text-muted-foreground">
            {formatBytes(group.files[0]?.size ?? 0)} each
          </span>
          {isResolved && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-destructive font-medium">
                saving {formatBytes(reclaimable)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onViewParentDirectory && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                // Use the first file's parent directory
                const firstPath = group.files[0]?.path ?? "";
                const parentDir = firstPath.substring(0, firstPath.lastIndexOf("/"));
                onViewParentDirectory(parentDir);
              }}
              title="View this directory in Similar Directories tab"
            >
              <FolderSearch className="h-3.5 w-3.5 mr-1" />
              View parent
            </Button>
          )}
          {isResolved && (
            <Badge variant="success" className="text-xs">
              <Check className="h-3 w-3 mr-1" />
              Resolved
            </Badge>
          )}
          {!isResolved && suggestion && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-primary border-primary/30"
              onClick={() => onAcceptSuggestion(group.checksum)}
            >
              Accept Suggestion
            </Button>
          )}
        </div>
      </div>

      {/* Auto-resolved banner */}
      {autoResolution && keeperFileId === autoResolution.fileId && (
        <div className="px-4 py-2 bg-success/5 border-b border-success/20 flex items-center gap-2">
          <CheckCircle className="h-3.5 w-3.5 text-success" />
          <span className="text-xs text-success">
            {autoResolution.reason}
          </span>
        </div>
      )}

      {/* File list */}
      <div className="divide-y divide-border">
        {group.files.map((file) => {
          const isKeeper = file.id === keeperFileId;
          const isDoomed = isResolved && !isKeeper;
          const isSuggested =
            !isResolved && suggestion?.suggestedFileId === file.id;

          return (
            <div
              key={file.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5",
                isKeeper && "bg-success/5",
                isDoomed && "bg-destructive/5 opacity-60",
                isSuggested && "border-l-2 border-l-primary",
                isAutoResolved && !isKeeper && "opacity-50"
              )}
            >
              {/* Status badge / action button */}
              <div className="shrink-0 w-24">
                {isKeeper ? (
                  <button
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success/15 px-2.5 py-1 rounded cursor-pointer hover:bg-success/25 transition-colors"
                    onClick={() => onClearKeeper(group.checksum)}
                    title="Click to unmark as keeper"
                  >
                    <Shield className="h-3 w-3" />
                    KEEP
                  </button>
                ) : isDoomed ? (
                  <span className="inline-flex items-center text-[10px] font-semibold text-destructive bg-destructive/15 px-2.5 py-1 rounded">
                    DELETE
                  </span>
                ) : isSuggested ? (
                  <button
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 border border-dashed border-primary/30 px-2.5 py-1 rounded cursor-pointer hover:bg-primary/20 transition-colors"
                    onClick={() => onSetKeeper(group.checksum, file.id)}
                  >
                    Suggested
                  </button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2.5 text-success border-success/30 hover:bg-success/10"
                    onClick={() => onSetKeeper(group.checksum, file.id)}
                  >
                    Keep
                  </Button>
                )}
              </div>

              {/* Path */}
              <div
                className={cn(
                  "flex-1 font-mono text-xs break-all leading-relaxed",
                  isDoomed
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {file.path}
                {isKeeper && fileStatuses?.get(file.id) === "doomed" && (
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>Parent directory is staged for deletion — keeper will be lost</span>
                  </div>
                )}
              </div>

              {/* Cross-tab status badges */}
              {fileStatuses?.get(file.id) === "original" && (
                <span className="text-[9px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded shrink-0">
                  Original dir
                </span>
              )}
              {fileStatuses?.get(file.id) === "doomed" && (
                <span className="text-[9px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded shrink-0">
                  Pending delete
                </span>
              )}

              {/* Metadata */}
              <div className="shrink-0 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>{formatBytes(file.size)}</span>
                <span className="w-20 text-right">
                  {file.mtime
                    ? new Date(file.mtime * 1000).toISOString().slice(0, 10)
                    : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
