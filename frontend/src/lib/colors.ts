export function getSimilarityColor(percent: number): string {
  if (percent >= 90) return "text-red-500";
  if (percent >= 70) return "text-amber-500";
  if (percent >= 50) return "text-yellow-500";
  return "text-green-500";
}

export function getSimilarityBgColor(percent: number): string {
  if (percent >= 90) return "bg-red-500/10 text-red-500 border-red-500/20";
  if (percent >= 70) return "bg-amber-500/10 text-amber-500 border-amber-500/20";
  if (percent >= 50) return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
  return "bg-green-500/10 text-green-500 border-green-500/20";
}

export function getRelationshipColor(relationship: string): string {
  switch (relationship) {
    case "exact":
      return "text-red-500";
    case "subset":
      return "text-amber-500";
    case "superset":
      return "text-blue-500";
    case "overlap":
      return "text-yellow-500";
    case "structural_match":
      return "text-purple-500";
    default:
      return "text-muted-foreground";
  }
}

export function getRelationshipBgColor(relationship: string): string {
  switch (relationship) {
    case "exact":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    case "subset":
      return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    case "superset":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "overlap":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    case "structural_match":
      return "bg-purple-500/10 text-purple-500 border-purple-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
