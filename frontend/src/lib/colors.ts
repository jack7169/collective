export function getSimilarityColor(percent: number): string {
  if (percent >= 90) return "text-red-400";
  if (percent >= 70) return "text-orange-400";
  if (percent >= 50) return "text-yellow-400";
  return "text-green-400";
}

export function getSimilarityBgColor(percent: number): string {
  if (percent >= 90) return "bg-red-400/10 text-red-400 border-red-400/20";
  if (percent >= 70) return "bg-orange-400/10 text-orange-400 border-orange-400/20";
  if (percent >= 50) return "bg-yellow-400/10 text-yellow-400 border-yellow-400/20";
  return "bg-green-400/10 text-green-400 border-green-400/20";
}

export function getRelationshipColor(relationship: string): string {
  switch (relationship) {
    case "exact":
      return "text-red-400";
    case "subset":
      return "text-orange-400";
    case "superset":
      return "text-blue-400";
    case "overlap":
      return "text-yellow-400";
    case "structural_match":
      return "text-purple-400";
    default:
      return "text-muted-foreground";
  }
}

export function getRelationshipBgColor(relationship: string): string {
  switch (relationship) {
    case "exact":
      return "bg-red-400/10 text-red-400 border-red-400/20";
    case "subset":
      return "bg-orange-400/10 text-orange-400 border-orange-400/20";
    case "superset":
      return "bg-blue-400/10 text-blue-400 border-blue-400/20";
    case "overlap":
      return "bg-yellow-400/10 text-yellow-400 border-yellow-400/20";
    case "structural_match":
      return "bg-purple-400/10 text-purple-400 border-purple-400/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
