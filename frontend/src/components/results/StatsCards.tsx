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
  CardHeader,
  CardDescription,
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
      color: "text-primary",
    },
    {
      label: "Total Size",
      value: formatBytes(stats.total_size),
      icon: Database,
      color: "text-blue-400",
    },
    {
      label: "Duplicates Found",
      value: formatNumber(stats.duplicates_found),
      icon: Layers,
      color: "text-orange-400",
    },
    {
      label: "Top Groups",
      value: formatNumber(stats.top_groups?.length ?? 0),
      icon: Copy,
      color: "text-red-400",
    },
    {
      label: "Recoverable Space",
      value: formatBytes(stats.space_recoverable),
      icon: HardDrive,
      color: "text-yellow-400",
    },
    {
      label: "Recoverable Space",
      value: formatBytes(stats.space_recoverable),
      icon: FolderSync,
      color: "text-success",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-sm font-medium">
                {card.label}
              </CardDescription>
              <Icon className={`h-5 w-5 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
