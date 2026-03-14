import { useLocation, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useSystemHealth } from "@/hooks/useBrowse";
import { cn } from "@/lib/utils";

const routeNames: Record<string, string> = {
  "/": "Dashboard",
  "/scans/new": "New Scan",
  "/scans/saved": "Saved Scans",
  "/actions": "Actions Log",
  "/settings": "Settings",
};

function getBreadcrumbs(pathname: string): { label: string; path: string }[] {
  const crumbs: { label: string; path: string }[] = [];

  if (pathname === "/") {
    crumbs.push({ label: "Dashboard", path: "/" });
    return crumbs;
  }

  crumbs.push({ label: "Dashboard", path: "/" });

  if (routeNames[pathname]) {
    crumbs.push({ label: routeNames[pathname]!, path: pathname });
    return crumbs;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "scans" && parts[1]) {
    crumbs.push({ label: "Scans", path: "/" });
    const scanId = parts[1];

    if (parts[2] === "progress") {
      crumbs.push({ label: `Scan ${scanId.slice(0, 8)}`, path: `/scans/${scanId}` });
      crumbs.push({ label: "Progress", path: pathname });
    } else if (parts[2] === "similar") {
      crumbs.push({ label: `Scan ${scanId.slice(0, 8)}`, path: `/scans/${scanId}` });
      crumbs.push({ label: "Similar Directories", path: pathname });
    } else if (parts[2] === "compare") {
      crumbs.push({ label: `Scan ${scanId.slice(0, 8)}`, path: `/scans/${scanId}` });
      crumbs.push({ label: "Compare", path: pathname });
    } else {
      crumbs.push({ label: `Scan ${scanId.slice(0, 8)}`, path: pathname });
    }
  }

  return crumbs;
}

export function TopBar() {
  const location = useLocation();
  const { data: health } = useSystemHealth();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  const isHealthy = health?.status === "ok";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {i < breadcrumbs.length - 1 ? (
              <Link
                to={crumb.path}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      {/* Right side — system status */}
      <div className="flex items-center gap-2">
        {health && (
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isHealthy ? "bg-success" : "bg-destructive"
              )}
            />
            <span className="text-muted-foreground">
              {isHealthy ? "Healthy" : "Error"}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
