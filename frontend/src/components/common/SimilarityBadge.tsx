import { getSimilarityBgColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface SimilarityBadgeProps {
  value: number;
  className?: string;
}

export function SimilarityBadge({ value, className }: SimilarityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
        getSimilarityBgColor(value),
        className
      )}
    >
      {value.toFixed(1)}%
    </span>
  );
}
