import { formatBytes, formatPercent } from "@/lib/format";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SpaceChartProps {
  totalSize: number;
  recoverable: number;
}

export function SpaceChart({ totalSize, recoverable }: SpaceChartProps) {
  if (totalSize <= 0) return null;

  const usedSize = totalSize - recoverable;
  const recoverablePct = (recoverable / totalSize) * 100;
  const usedPct = 100 - recoverablePct;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Space Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stacked bar */}
        <div className="flex h-6 rounded-full overflow-hidden bg-muted">
          {usedPct > 0 && (
            <div
              className="bg-blue-500 transition-all duration-500"
              style={{ width: `${usedPct}%` }}
            />
          )}
          {recoverablePct > 0 && (
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${recoverablePct}%` }}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-blue-500" />
            <span className="text-muted-foreground">
              Unique: {formatBytes(usedSize)} ({formatPercent(usedPct)})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-green-500" />
            <span className="text-muted-foreground">
              Recoverable: {formatBytes(recoverable)} ({formatPercent(recoverablePct)})
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
