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

  const data = [
    { name: "Unique", value: usedSize, pct: usedPct, color: "#3b82f6" },
    { name: "Recoverable", value: recoverable, pct: recoverablePct, color: "#10b981" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Space Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stacked bar */}
        <div className="flex h-10 rounded-lg overflow-hidden">
          <div
            className="transition-all duration-500"
            style={{ width: `${usedPct}%`, backgroundColor: "#3b82f6" }}
            title={`Unique: ${formatBytes(usedSize)} (${formatPercent(usedPct)})`}
          />
          <div
            className="transition-all duration-500"
            style={{ width: `${recoverablePct}%`, backgroundColor: "#10b981" }}
            title={`Recoverable: ${formatBytes(recoverable)} (${formatPercent(recoverablePct)})`}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-sm">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className="text-muted-foreground">
                {d.name}: {formatBytes(d.value)} ({formatPercent(d.pct)})
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
