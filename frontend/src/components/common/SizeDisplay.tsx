import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SizeDisplayProps {
  bytes: number;
  className?: string;
}

export function SizeDisplay({ bytes, className }: SizeDisplayProps) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatBytes(bytes)}
    </span>
  );
}
