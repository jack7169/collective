import { useState } from "react";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Home,
  Check,
  Loader2,
} from "lucide-react";
import { useBrowse } from "@/hooks/useBrowse";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/api/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PathPickerProps {
  selectedPaths: string[];
  onChange: (paths: string[]) => void;
}

export function PathPicker({ selectedPaths, onChange }: PathPickerProps) {
  const [currentPath, setCurrentPath] = useState("/mnt/user");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const { data, isLoading } = useBrowse(currentPath);
  const queryClient = useQueryClient();

  const pathParts = currentPath.split("/").filter(Boolean);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      await post("/browse/mkdir", { path: currentPath, name });
      queryClient.invalidateQueries({ queryKey: ["browse", currentPath] });
      setNewFolderName("");
      setShowNewFolder(false);
    } catch {
      // Error handling via toast if available
    } finally {
      setIsCreating(false);
    }
  };

  const togglePath = (path: string) => {
    if (selectedPaths.includes(path)) {
      onChange(selectedPaths.filter((p) => p !== path));
    } else {
      onChange([...selectedPaths, path]);
    }
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  return (
    <div className="space-y-3">
      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 shrink-0"
          onClick={() => navigateTo("/mnt/user")}
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
        {pathParts.map((part, i) => {
          const fullPath = "/" + pathParts.slice(0, i + 1).join("/");
          return (
            <span key={fullPath} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => navigateTo(fullPath)}
              >
                {part}
              </Button>
            </span>
          );
        })}
        <div className="ml-auto shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowNewFolder(!showNewFolder)}
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1" />
            New Folder
          </Button>
        </div>
      </div>

      {/* New folder inline input */}
      {showNewFolder && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
            }}
            placeholder="New folder name..."
            className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={handleCreateFolder}
            disabled={isCreating || !newFolderName.trim()}
          >
            {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Directory listing */}
      <ScrollArea className="h-96 rounded-md border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.entries || data.entries.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No directories found
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {data.entries
              .filter((e) => e.is_dir)
              .map((entry) => {
                const isSelected = selectedPaths.includes(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                      isSelected
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Checkbox area */}
                      <button
                        type="button"
                        onClick={() => togglePath(entry.path)}
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </button>

                      {/* Folder icon + name (clickable to navigate) */}
                      <button
                        type="button"
                        className="flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
                        onClick={() => navigateTo(entry.path)}
                      >
                        {isSelected ? (
                          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </button>
                    </div>

                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {entry.size != null ? formatBytes(entry.size) : ""}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </ScrollArea>

      {/* Selected paths */}
      {selectedPaths.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Selected ({selectedPaths.length}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {selectedPaths.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePath(p)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-mono text-primary hover:bg-primary/20 transition-colors"
              >
                {p}
                <span className="text-primary/60">x</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
