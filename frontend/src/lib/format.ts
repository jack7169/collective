import { formatDistanceToNow, parseISO } from "date-fns";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "0";
  return n.toLocaleString("en-US");
}

export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function formatDate(date: string): string {
  try {
    // Backend returns naive UTC datetimes — ensure they're parsed as UTC
    const normalized = date.endsWith("Z") || date.includes("+") ? date : date + "Z";
    return formatDistanceToNow(parseISO(normalized), { addSuffix: true });
  } catch {
    return date;
  }
}

export function formatTimestamp(date: string): string {
  try {
    const normalized = date.endsWith("Z") || date.includes("+") ? date : date + "Z";
    const d = parseISO(normalized);
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return date;
  }
}

export function formatElapsed(startedAt: string, completedAt: string): string {
  try {
    const normS = startedAt.endsWith("Z") || startedAt.includes("+") ? startedAt : startedAt + "Z";
    const normC = completedAt.endsWith("Z") || completedAt.includes("+") ? completedAt : completedAt + "Z";
    const ms = parseISO(normC).getTime() - parseISO(normS).getTime();
    if (ms < 0) return "—";
    return formatDuration(ms);
  } catch {
    return "—";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
