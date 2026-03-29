import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
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
        <ResponsiveContainer width="100%" height={48}>
          <BarChart
            data={[{ unique: usedPct, recoverable: recoverablePct }]}
            layout="vertical"
            barCategoryGap={0}
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <XAxis type="number" domain={[0, 100]} hide />
            <Bar dataKey="unique" stackId="a" fill="#3b82f6" radius={[8, 0, 0, 8]} />
            <Bar dataKey="recoverable" stackId="a" fill="#10b981" radius={[0, 8, 8, 0]} />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md bg-popover border border-border px-3 py-2 text-xs shadow-md">
                    {payload.map((p) => (
                      <div key={p.dataKey as string} className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.fill as string }} />
                        <span className="capitalize">{p.dataKey as string}:</span>
                        <span className="font-medium">{formatPercent(p.value as number)}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>

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
