import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCompare } from "@/api/results";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { CompareFile } from "@/api/types";

interface DifferencesDropdownProps {
  scanId: string;
  dirA: string;
  dirB: string;
  uniqueToA: number;
  uniqueToB: number;
}

const FILES_PER_PAGE = 10;

function formatMtime(mtime: string): string {
  if (!mtime) return "—";
  const date = new Date(
    typeof mtime === "number" ? (mtime as number) * 1000 : mtime
  );
  if (isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function computeVerdict(
  onlyInA: CompareFile[],
  onlyInB: CompareFile[]
): {
  type: "newer_b" | "newer_a" | "merge" | "identical";
  message: string;
} {
  if (onlyInA.length === 0 && onlyInB.length === 0) {
    return {
      type: "identical",
      message: "Identical — safe to remove either copy",
    };
  }

  const parseMtime = (f: CompareFile) =>
    typeof f.mtime === "number"
      ? (f.mtime as number)
      : new Date(f.mtime).getTime() / 1000;

  const mtimesA = onlyInA.map(parseMtime).filter((t) => t > 0);
  const mtimesB = onlyInB.map(parseMtime).filter((t) => t > 0);

  if (mtimesA.length === 0 || mtimesB.length === 0) {
    if (onlyInA.length > 0 && onlyInB.length > 0) {
      return {
        type: "merge",
        message: "Both sides have unique files — merge recommended",
      };
    }
    if (onlyInB.length > 0) {
      return { type: "newer_b", message: "B has files not in A" };
    }
    return { type: "newer_a", message: "A has files not in B" };
  }

  const maxA = Math.max(...mtimesA);
  const maxB = Math.max(...mtimesB);
  const minA = Math.min(...mtimesA);
  const minB = Math.min(...mtimesB);

  if (onlyInA.length === 0 && onlyInB.length > 0) {
    return {
      type: "newer_b",
      message: `B appears to be a newer version of A — B has ${onlyInB.length} file${onlyInB.length > 1 ? "s" : ""} not in A`,
    };
  }
  if (onlyInB.length === 0 && onlyInA.length > 0) {
    return {
      type: "newer_a",
      message: `A appears to be a newer version of B — A has ${onlyInA.length} file${onlyInA.length > 1 ? "s" : ""} not in B`,
    };
  }

  if (minB > maxA) {
    return {
      type: "newer_b",
      message:
        "B appears to be a newer version of A — B's unique files are all newer",
    };
  }
  if (minA > maxB) {
    return {
      type: "newer_a",
      message:
        "A appears to be a newer version of B — A's unique files are all newer",
    };
  }

  return {
    type: "merge",
    message:
      "Both sides have unique files with overlapping dates — merge recommended",
  };
}

function FileList({
  files,
  label,
  totalSize,
  colorClass,
  bgClass,
}: {
  files: CompareFile[];
  label: string;
  totalSize: number;
  colorClass: string;
  bgClass: string;
}) {
  const [visibleCount, setVisibleCount] = useState(FILES_PER_PAGE);
  const visible = files.slice(0, visibleCount);
  const remaining = files.length - visibleCount;

  const mtimes = files
    .map((f) =>
      typeof f.mtime === "number"
        ? (f.mtime as number)
        : new Date(f.mtime).getTime() / 1000
    )
    .filter((t) => t > 0);
  const minDate =
    mtimes.length > 0 ? formatMtime(String(Math.min(...mtimes))) : null;
  const maxDate =
    mtimes.length > 0 ? formatMtime(String(Math.max(...mtimes))) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold ${colorClass}`}
        >
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(totalSize)} total
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((file) => (
          <div
            key={file.path}
            className={`flex items-center justify-between px-2 py-1 rounded text-[11px] ${bgClass}`}
          >
            <span className="font-mono text-foreground truncate mr-3">
              {file.name}
            </span>
            <span className="font-mono text-muted-foreground whitespace-nowrap">
              {formatMtime(file.mtime)}
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-primary mt-1 h-7"
            onClick={(e) => {
              e.stopPropagation();
              setVisibleCount((c) => c + FILES_PER_PAGE);
            }}
          >
            Load {Math.min(remaining, FILES_PER_PAGE)} more ({remaining}{" "}
            remaining)
          </Button>
        )}
      </div>
      {minDate && maxDate && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          Date range: <span className="text-foreground">{minDate}</span> →{" "}
          <span className="text-foreground">{maxDate}</span>
        </div>
      )}
    </div>
  );
}

export function DifferencesDropdown({
  scanId,
  dirA,
  dirB,
  uniqueToA,
  uniqueToB,
}: DifferencesDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasAnyDifferences = uniqueToA > 0 || uniqueToB > 0;

  // Only fetch comparison data when dropdown is opened
  const { data: compare, isLoading } = useCompare(
    isOpen ? scanId : undefined,
    isOpen ? dirA : null,
    isOpen ? dirB : null
  );

  const verdict = compare
    ? computeVerdict(compare.only_in_a, compare.only_in_b)
    : null;

  const verdictIcon = {
    newer_a: <ArrowRight className="h-4 w-4 text-blue-400 rotate-180" />,
    newer_b: <ArrowRight className="h-4 w-4 text-blue-400" />,
    merge: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    identical: <CheckCircle className="h-4 w-4 text-success" />,
  };

  const verdictColor = {
    newer_a: "text-blue-400",
    newer_b: "text-blue-400",
    merge: "text-amber-400",
    identical: "text-success",
  };

  if (!hasAnyDifferences) {
    return (
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground flex items-center gap-2 opacity-0 group-hover/peer:opacity-100 transition-opacity">
        <CheckCircle className="h-3.5 w-3.5 text-success" />
        Identical — no unique files on either side
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Toggle bar */}
      <button
        className="w-full px-4 py-2 flex items-center gap-2 hover:bg-accent/50 transition-colors text-left"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-primary">
          Show differences
        </span>
        <span className="text-[11px] text-muted-foreground">
          — {uniqueToA} unique to A · {uniqueToB} unique to B
        </span>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="bg-background/50">
          {isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Loading file details...
            </div>
          ) : compare ? (
            <>
              {/* Verdict banner */}
              {verdict && (
                <div className="px-4 py-2.5 border-t border-border flex items-center gap-2">
                  {verdictIcon[verdict.type]}
                  <span
                    className={`text-xs font-semibold ${verdictColor[verdict.type]}`}
                  >
                    {verdict.message}
                  </span>
                </div>
              )}

              {/* File lists side by side */}
              <div className="grid grid-cols-2 border-t border-border">
                <div className="p-3 border-r border-border">
                  <FileList
                    files={compare.only_in_a}
                    label={`${compare.only_in_a.length} files only in A`}
                    totalSize={compare.only_a_size}
                    colorClass="text-orange-400"
                    bgClass="bg-orange-500/5"
                  />
                </div>
                <div className="p-3">
                  <FileList
                    files={compare.only_in_b}
                    label={`${compare.only_in_b.length} files only in B`}
                    totalSize={compare.only_b_size}
                    colorClass="text-blue-400"
                    bgClass="bg-blue-500/5"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-4 py-2.5 border-t border-border flex justify-end gap-2">
                {verdict?.type === "newer_b" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-blue-400 border-blue-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge B → A
                  </Button>
                )}
                {verdict?.type === "newer_a" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-blue-400 border-blue-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge A → B
                  </Button>
                )}
                {verdict?.type === "merge" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-amber-400 border-amber-400/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Merge Both
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    to={`/scans/${scanId}/compare?a=${encodeURIComponent(dirA)}&b=${encodeURIComponent(dirB)}`}
                  >
                    Open Full Compare
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
