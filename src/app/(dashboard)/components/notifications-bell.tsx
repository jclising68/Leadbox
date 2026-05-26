"use client";

import { Bell, MessageSquare, BellRing, CheckCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: "reply" | "followUp";
  threadId: string;
  title: string;
  subtitle: string;
  at: string;
  isUnread: boolean;
};

const LAST_SEEN_KEY = "lb:notifications:lastSeenAt";
const DISMISSED_KEY = "lb:notifications:dismissedIds";
// Cap the dismissed set so localStorage doesn't grow unbounded for
// long-running sessions. 500 IDs comfortably covers the 40-item API window.
const DISMISSED_MAX = 500;

function readLastSeen(): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(LAST_SEEN_KEY);
  return v ? Number(v) : 0;
}

function writeLastSeen(ts: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEEN_KEY, String(ts));
}

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  if (typeof window === "undefined") return;
  const arr = Array.from(ids).slice(-DISMISSED_MAX);
  window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationsBell() {
  const workspaceId = useCurrentWorkspaceId();
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeSlug = workspaces?.find((w: { id: string }) => w.id === activeWorkspaceId)?.slug;
  const router = useRouter();
  // Lazy init — only run the localStorage read once on mount. On the server
  // this returns 0 (SSR), and the first client render hydrates with the
  // persisted value.
  const [lastSeen, setLastSeen] = useState<number>(() => readLastSeen());
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ items: NotificationItem[]; generatedAt: string }>({
    queryKey: ["notifications", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/notifications", {
        headers: { "x-workspace-id": workspaceId!, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    enabled: !!workspaceId,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const allItems = data?.items ?? [];
  const items = allItems.filter((i) => !dismissed.has(i.id));
  const unreadCount = items.filter((i) => new Date(i.at).getTime() > lastSeen).length;
  const shownCount = Math.min(unreadCount, 99);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const newest = items[0] ? new Date(items[0].at).getTime() : Date.now();
      writeLastSeen(newest);
      setLastSeen(newest);
    }
  }

  function handleClick(item: NotificationItem) {
    setOpen(false);
    if (!activeSlug) return;
    router.push(`/ws/${activeSlug}/inbox?thread=${item.threadId}`);
  }

  function handleClearAll() {
    // Dismiss all currently-visible items. Newer items the API returns later
    // will still appear because their IDs won't be in the dismissed set yet.
    const next = new Set(dismissed);
    for (const item of items) next.add(item.id);
    writeDismissed(next);
    setDismissed(next);
    const now = Date.now();
    writeLastSeen(now);
    setLastSeen(now);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className="relative flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground flex items-center justify-center tabular-nums">
            {shownCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        alignOffset={-8}
        sideOffset={6}
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2">
          <span className="text-sm font-medium">Notifications</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {items.length === 0 ? "Nothing yet" : "Last 7 days"}
            </span>
            {items.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title="Mark all as read and hide"
              >
                <CheckCheck className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Bell className="h-6 w-6 opacity-40 mb-2" />
              <p className="text-xs">No new replies yet.</p>
            </div>
          ) : (
            items.map((item) => {
              const isNew = new Date(item.at).getTime() > lastSeen;
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={cn(
                    "w-full text-left px-3 py-2 border-b border-border/60 last:border-b-0 hover:bg-accent transition-colors",
                    isNew && "bg-primary/5",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      "mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ring-1 ring-inset",
                      item.type === "followUp"
                        ? "bg-amber-500/10 text-amber-600 ring-amber-500/20"
                        : "bg-primary/10 text-primary ring-primary/20"
                    )}>
                      {item.type === "followUp" ? (
                        <BellRing className="h-3 w-3" />
                      ) : (
                        <MessageSquare className="h-3 w-3" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">{item.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {formatRelative(item.at)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {item.subtitle}
                      </p>
                    </div>
                    {isNew && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
