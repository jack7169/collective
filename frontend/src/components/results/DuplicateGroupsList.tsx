import { useState } from "react";
import {
  Trash2,
  Link,
  Link2,
  ChevronDown,
  Files,
  Layers,
} from "lucide-react";
import { useDuplicateGroups } from "@/api/results";
import { useGroupSelection } from "@/hooks/useGroupSelection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DuplicateGroupCard } from "./DuplicateGroupCard";
import { formatBytes, formatNumber } from "@/lib/format";
import type { QueuedAction } from "@/hooks/useActionQueue";
import type { DuplicateGroup } from "@/api/types";

interface DuplicateGroupsListProps {
  scanId: string;
  addAction: (action: Omit<QueuedAction, "id">) => void;
}

export function DuplicateGroupsList({
  scanId,
  addAction,
}: DuplicateGroupsListProps) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("size");
  const { data, isLoading } = useDuplicateGroups(scanId, page, 20, sortBy);
  const groups = data?.items ?? [];

  const selection = useGroupSelection(groups);

  const handleBulkAction = (type: "delete" | "hardlink" | "symlink") => {
    for (const file of selection.selectedFiles) {
      if (type === "delete") {
        addAction({
          type: "delete",
          sourcePath: file.path,
          description: `Delete: ${file.path.split("/").pop()}`,
          estimatedSize: file.size,
        });
      } else {
        // Find the original in the same group
        for (const group of groups) {
          const original = group.files.find((f) => f.is_original);
          if (original && group.files.some((f) => f.id === file.id)) {
            addAction({
              type,
              sourcePath: file.path,
              destPath: original.path,
              description: `${type}: ${file.path.split("/").pop()} -> original`,
              estimatedSize: file.size,
            });
            break;
          }
        }
      }
    }
    selection.clearSelection();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading duplicate groups...
      </div>
    );
  }

  if (!data?.items || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">
          No duplicate file groups found
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="size">Sort by Size</SelectItem>
              <SelectItem value="file_count">Sort by Count</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                Select
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => selection.selectAllDuplicates(groups)}>
                Select all duplicates
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selection.clearSelection()}>
                Clear all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-3">
          {selection.selectedCount > 0 && (
            <>
              <Badge variant="secondary" className="text-xs">
                {formatNumber(selection.selectedCount)} files ({formatBytes(selection.selectedTotalSize)})
              </Badge>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleBulkAction("delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction("hardlink")}
              >
                <Link className="h-3.5 w-3.5" />
                Hardlink
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction("symlink")}
              >
                <Link2 className="h-3.5 w-3.5" />
                Symlink
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Group cards */}
      {groups.map((group) => (
        <DuplicateGroupCard
          key={group.checksum}
          group={group}
          selected={selection.selected}
          onToggle={selection.toggleFile}
          onSelectAllDuplicates={selection.selectAllDuplicatesInGroup}
          onSelectExceptOldest={selection.selectAllExceptOldest}
          onSelectExceptNewest={selection.selectAllExceptNewest}
          onClearGroup={selection.clearGroup}
        />
      ))}

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.pages} ({formatNumber(data.total)} groups)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
