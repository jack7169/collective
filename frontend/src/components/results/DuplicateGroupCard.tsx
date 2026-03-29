import {
  ChevronDown,
  Shield,
  Files,
  Trash2,
  Link,
  Clock,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/api/types";

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  selected: Set<number>;
  onToggle: (fileId: number) => void;
  onSelectAllDuplicates: (group: DuplicateGroup) => void;
  onSelectExceptOldest: (group: DuplicateGroup) => void;
  onSelectExceptNewest: (group: DuplicateGroup) => void;
  onClearGroup: (group: DuplicateGroup) => void;
}

export function DuplicateGroupCard({
  group,
  selected,
  onToggle,
  onSelectAllDuplicates,
  onSelectExceptOldest,
  onSelectExceptNewest,
  onClearGroup,
}: DuplicateGroupCardProps) {
  const groupSelectedCount = group.files.filter((f) =>
    selected.has(f.id)
  ).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">
              {group.checksum.slice(0, 16)}...
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              <Files className="h-3 w-3 mr-1" />
              {group.file_count} copies
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {formatBytes(group.total_size)}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {groupSelectedCount > 0 && (
              <Badge variant="default" className="text-xs">
                {groupSelectedCount} selected
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelectAllDuplicates(group)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2 text-destructive" />
                  Select all duplicates
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelectExceptOldest(group)}>
                  <Clock className="h-3.5 w-3.5 mr-2" />
                  Select all except oldest
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelectExceptNewest(group)}>
                  <Clock className="h-3.5 w-3.5 mr-2" />
                  Select all except newest
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onClearGroup(group)}>
                  Clear selection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0.5">
          {group.files.map((file) => {
            const isSelected = selected.has(file.id);
            return (
              <label
                key={file.id}
                className={cn(
                  "flex items-center gap-3 rounded px-3 py-2 text-sm cursor-pointer transition-colors",
                  file.is_original
                    ? "bg-success/5 border border-success/20"
                    : isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-accent/50 border border-transparent"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={file.is_original}
                  onCheckedChange={() => onToggle(file.id)}
                />
                {file.is_original && (
                  <Shield className="h-3.5 w-3.5 text-success shrink-0" />
                )}
                <span className="font-mono text-xs truncate flex-1 min-w-0">
                  {file.path}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatBytes(file.size)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">
                  {file.mtime
                    ? formatDate(new Date(file.mtime * 1000).toISOString())
                    : "--"}
                </span>
                {file.is_original && (
                  <Badge variant="success" className="text-[10px] shrink-0">
                    original
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
