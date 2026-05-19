"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  Inbox,
  MailOpen,
  Briefcase,
  BarChart2,
  Archive,
  Trash2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useWorkspaces } from "@/hooks/use-workspace";
import { Logo } from "@/components/logo";

function useWorkspaceSlug() {
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const ws = workspaces?.find((w: { id: string }) => w.id === activeWorkspaceId);
  return ws?.slug || "";
}

function useWsHref(path: string) {
  const slug = useWorkspaceSlug();
  return slug ? `/ws/${slug}${path}` : path;
}

const mainNavItems = [
  { label: "Inbox", path: "/inbox", icon: Inbox, matchEnd: "/inbox" },
  { label: "Outbound Inbox", path: "/outbound-inbox", icon: MailOpen, matchEnd: "/outbound-inbox" },
  { label: "Leads", path: "/leads", icon: Briefcase, matchEnd: "/leads" },
  { label: "KPI", path: "/kpi", icon: BarChart2, matchEnd: "/kpi" },
];

const bottomNavItems = [
  { label: "Archive", path: "/inbox?status=ARCHIVED", icon: Archive, matchStatus: "ARCHIVED" },
  { label: "Spam", path: "/inbox?status=SPAM", icon: AlertCircle, matchStatus: "SPAM" },
  { label: "Trash", path: "/inbox?status=TRASH", icon: Trash2, matchStatus: "TRASH" },
];

function NavLink({
  item,
  collapsed,
}: {
  item: { label: string; path: string; icon: React.ElementType; matchEnd?: string; matchStatus?: string };
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = useWsHref(item.path);

  let active = false;
  if (item.matchStatus) {
    active = pathname.endsWith("/inbox") && searchParams.get("status") === item.matchStatus;
  } else if (item.matchEnd) {
    active = pathname.endsWith(item.matchEnd) && !searchParams.get("status");
  }

  return (
    <Link
      href={href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md transition-colors",
        collapsed ? "justify-center w-9 h-9" : "px-3 h-9",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn(
            "absolute rounded-full bg-brand-blue",
            collapsed ? "bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2" : "left-0 top-1.5 bottom-1.5 w-0.5"
          )}
        />
      )}
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="text-sm truncate">{item.label}</span>}
    </Link>
  );
}

export function AppSidebar() {
  const router = useRouter();
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const { sidebarCollapsed } = useInboxStore();

  const activeWorkspace = workspaces?.find((w: { id: string }) => w.id === activeWorkspaceId);
  const collapsed = sidebarCollapsed;

  const handleSwitchWorkspace = (ws: { id: string; slug: string }) => {
    // Just navigate — workspace layout handles everything else
    router.push(`/ws/${ws.slug}/inbox`);
  };

  return (
    <div
      className={cn(
        "border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col h-full transition-all duration-200 overflow-hidden",
        collapsed ? "w-14" : "w-48"
      )}
    >
      {/* Brand + workspace switcher */}
      <div className={cn("flex items-center py-3", collapsed ? "justify-center" : "px-3 gap-2")}>
        {collapsed ? (
          <Logo iconOnly className="h-7 w-auto shrink-0" priority />
        ) : (
          <Logo className="h-6 w-auto shrink-0" priority />
        )}
      </div>

      {/* Workspace switcher */}
      <div className={cn("flex items-center pb-3", collapsed ? "justify-center" : "px-3 gap-2")}>
        <DropdownMenu>
          <DropdownMenuTrigger className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm hover:bg-primary/20 transition-colors cursor-pointer outline-none shrink-0">
            {activeWorkspace?.name?.[0]?.toUpperCase() || "L"}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-56">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              Switch workspace
            </div>
            {workspaces?.map((ws: { id: string; name: string; slug: string }) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => handleSwitchWorkspace(ws)}
                className="gap-2"
              >
                <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-xs font-medium">
                  {ws.name[0]?.toUpperCase()}
                </div>
                <span className="flex-1">{ws.name}</span>
                {ws.id === activeWorkspaceId && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <div className="border-t my-1" />
            <DropdownMenuItem onClick={() => router.push(activeWorkspace ? `/ws/${activeWorkspace.slug}/settings/workspace` : "/settings/workspace")}>
              Manage workspaces
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!collapsed && (
          <span className="text-sm font-semibold truncate">
            {activeWorkspace?.name || "LeadBox"}
          </span>
        )}
      </div>

      {/* Main Nav */}
      <div className={cn("space-y-0.5 flex flex-col", collapsed ? "items-center" : "px-2")}>
        {mainNavItems.map((item) => (
          <NavLink key={item.path} item={item} collapsed={collapsed} />
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Nav */}
      <div className={cn("space-y-0.5 flex flex-col pb-3", collapsed ? "items-center" : "px-2")}>
        {bottomNavItems.map((item) => (
          <NavLink key={item.path} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

export function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar } = useInboxStore();

  return (
    <button
      onClick={toggleSidebar}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {sidebarCollapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  );
}
