import { NavLink, Link } from "react-router-dom";
import {
  LayoutDashboard,
  ScanSearch,
  ListChecks,
  Settings,
  ChevronLeft,
  ChevronRight,
  Database,
  BookmarkCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }],
  },
  {
    title: "SCANNING",
    items: [
      { label: "New Scan", icon: ScanSearch, to: "/scans/new" },
      { label: "Saved Scans", icon: BookmarkCheck, to: "/scans/saved" },
    ],
  },
  {
    title: "RESULTS",
    items: [{ label: "Actions Log", icon: ListChecks, to: "/actions" }],
  },
  {
    title: "SYSTEM",
    items: [{ label: "Settings", icon: Settings, to: "/settings" }],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-300 overflow-hidden",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <Link
        to="/"
        className="flex h-16 shrink-0 items-center border-b border-border px-4 gap-3 hover:bg-accent/50 transition-colors"
      >
        <Database className="h-6 w-6 shrink-0 text-primary" />
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight whitespace-nowrap leading-tight">
              Collective
            </span>
            <span className="text-[10px] text-muted-foreground leading-none">
              v0.1.0
            </span>
          </div>
        )}
      </Link>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <div className="px-3 mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                {section.title}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      cn(
                        "flex flex-row items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[40px]",
                        isActive
                          ? "border-l-2 border-primary bg-primary/10 text-primary"
                          : "border-l-2 border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        collapsed && "justify-center px-2 border-l-0"
                      )
                    }
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {!collapsed && (
                      <span className="whitespace-nowrap leading-none">
                        {item.label}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn("w-full flex flex-row items-center gap-2", collapsed && "px-2")}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
