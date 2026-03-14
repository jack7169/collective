import {
  Files,
  FolderSync,
  HardDrive,
  Copy,
  Layers,
  Database,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { formatBytes, formatNumber } from "@/lib/format";
import type { ScanStats } from "@/api/types";

interface StatsCardsProps {
  stats: ScanStats;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      label: "Total Files",
      value: formatNumber(stats.total_files),
      icon: Files,
      borderColor: "border-l-blue-500",
      iconColor: "text-blue-500",
    },
    {
      label: "Total Size",
      value: formatBytes(stats.total_size),
      icon: Database,
      borderColor: "border-l-cyan-500",
      iconColor: "text-cyan-500",
    },
    {
      label: "Duplicates Found",
      value: formatNumber(stats.duplicates_found),
      icon: Layers,
      borderColor: "border-l-amber-500",
      iconColor: "text-amber-500",
    },
    {
      label: "Top Groups",
      value: formatNumber(stats.top_groups?.length ?? 0),
      icon: Copy,
      borderColor: "border-l-red-500",
      iconColor: "text-red-500",
    },
    {
      label: "Recoverable Space",
      value: formatBytes(stats.space_recoverable),
      icon: HardDrive,
      borderColor: "border-l-green-500",
      iconColor: "text-green-500",
    },
    {
      label: "Dir Similarity",
      value: formatBytes(stats.space_recoverable),
      icon: FolderSync,
      borderColor: "border-l-purple-500",
      iconColor: "text-purple-500",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className={`border-l-4 ${card.borderColor}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {card.label}
                  </p>
                  <p className="text-2xl font-bold mt-1">{card.value}</p>
                </div>
                <Icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
