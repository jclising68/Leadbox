"use client";

import { useThreads } from "@/hooks/use-threads";
import { useInboxStore } from "@/stores/inbox-store";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { cn } from "@/lib/utils";
import { Mail, Link2, Loader2, Filter, X, SlidersHorizontal, Zap, Send, RefreshCw, Search, ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

// Format a thread row's date column. We always show the actual provider
// date — never relative ("9hr ago") — so the user can scan dates directly
// and verify they line up with what they see in Instantly / HeyReach Unibox.
function formatDate(date: string) {
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null) {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

export function ThreadList() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useThreads();
  const {
    selectedThreadId, setSelectedThread, view,
    filterChannel, setFilterChannel,
    filterUnread, setFilterUnread,
    filterHasReply, setFilterHasReply,
    filterDateFrom, setFilterDateFrom,
    filterDateTo, setFilterDateTo,
    sortDir, setSortDir,
    searchQuery, setSearchQuery,
    clearFilters,
  } = useInboxStore();
  const [showFilters, setShowFilters] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();

  // Manual refresh: trigger a server-side sync, then refetch threads/labels.
  // Server skips integrations that synced very recently so this is cheap.
  async function handleRefresh() {
    if (!workspaceId || isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch("/api/integrations/sync-all", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      });
      const data: {
        triggered?: number;
        total?: number;
        results?: { provider: string; status: string; lastError?: string | null }[];
      } = await res.json().catch(() => ({}));

      const results = data?.results ?? [];
      const inactive = results.filter((r) => r.status === "skipped_inactive");
      const withErrors = results.filter((r) => r.lastError);

      if ((data?.total ?? 0) === 0) {
        toast.warning("No integrations in this workspace. Add one in Settings.");
      } else if (inactive.length > 0 && (data?.triggered ?? 0) === 0) {
        const names = inactive.map((r) => r.provider).join(", ");
        toast.warning(`${names} integration${inactive.length === 1 ? " is" : "s are"} inactive — re-enable in Settings.`);
      } else if (withErrors.length > 0) {
        const first = withErrors[0];
        toast.error(`${first.provider} last sync failed: ${first.lastError?.slice(0, 120)}`);
      } else if ((data?.triggered ?? 0) > 0) {
        toast.success(`Syncing ${data.triggered} integration${data.triggered === 1 ? "" : "s"}...`);
      } else {
        toast.info("Already up to date (synced within the last 2 min).");
      }
      // Refetch what's already in the DB right now; sync result will land
      // on the next 15s poll interval.
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["labels", workspaceId] }),
      ]);
    } catch {
      toast.error("Refresh failed");
    } finally {
      setIsSyncing(false);
    }
  }

  // Flatten all pages into single array
  const threads = useMemo(
    () => data?.pages?.flatMap((p) => p.threads) || [],
    [data]
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: threads.length + (hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
  });

  // Infinite scroll: load more when scrolling near bottom
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= threads.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualItems, threads.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Auto-scroll to the selected thread when the list loads (e.g. navigating
  // from the leads page). Only fires once per selectedThreadId change.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedThreadId || selectedThreadId === scrolledToRef.current) return;
    if (threads.length === 0) return;
    const idx = threads.findIndex((t: { id: string }) => t.id === selectedThreadId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: "start" });
      scrolledToRef.current = selectedThreadId;
    }
  }, [selectedThreadId, threads, rowVirtualizer]);

  const hasActiveFilters = !!filterChannel || filterUnread || filterHasReply || !!filterDateFrom || !!filterDateTo;

  const viewTitle = view === "ARCHIVED" ? "Archive" : view === "SPAM" ? "Spam" : view === "TRASH" ? "Trash" : "All messages";

  return (
    <div className="w-80 border-r border-border bg-card flex flex-col h-full">
      {/* Header with search + filters */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, email, message…"
            className="w-full pl-7 pr-7 py-1.5 text-xs rounded-md border border-input bg-background/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring/60 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{viewTitle}</h2>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {threads.length}{hasNextPage ? "+" : ""}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isSyncing}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-colors",
                "text-muted-foreground hover:text-foreground disabled:opacity-50"
              )}
              title="Pull latest from Instantly / HeyReach"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
            </button>
            <button
              onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-colors",
                sortDir === "asc"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={sortDir === "desc" ? "Sorted: newest first (click for oldest)" : "Sorted: oldest first (click for newest)"}
            >
              {sortDir === "desc" ? <ArrowDownNarrowWide className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-colors",
                showFilters || hasActiveFilters
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Channel filter */}
            <button
              onClick={() => setFilterChannel(filterChannel === "EMAIL" ? null : "EMAIL")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] border transition-colors",
                filterChannel === "EMAIL"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Mail className="h-3 w-3 inline mr-1" />
              Email
            </button>
            <button
              onClick={() => setFilterChannel(filterChannel === "LINKEDIN" ? null : "LINKEDIN")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] border transition-colors",
                filterChannel === "LINKEDIN"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Link2 className="h-3 w-3 inline mr-1" />
              LinkedIn
            </button>
            <button
              onClick={() => setFilterUnread(!filterUnread)}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] border transition-colors",
                filterUnread
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Unread only
            </button>
            <button
              onClick={() => setFilterHasReply(!filterHasReply)}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] border transition-colors",
                filterHasReply
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Has reply
            </button>
            {/* Date range — bound by message date (the original Instantly /
                HeyReach send/receive timestamp, not the synced-at time). */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filterDateFrom ?? ""}
                onChange={(e) => setFilterDateFrom(e.target.value || null)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[11px] border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40",
                  filterDateFrom
                    ? "border-primary/30 text-primary"
                    : "border-border text-muted-foreground"
                )}
                aria-label="From date"
                title="From date"
              />
              <span className="text-[11px] text-muted-foreground">→</span>
              <input
                type="date"
                value={filterDateTo ?? ""}
                onChange={(e) => setFilterDateTo(e.target.value || null)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[11px] border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40",
                  filterDateTo
                    ? "border-primary/30 text-primary"
                    : "border-border text-muted-foreground"
                )}
                aria-label="To date"
                title="To date"
              />
            </div>
            <button
              onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 7);
                setFilterDateFrom(d.toISOString().split("T")[0]);
                setFilterDateTo(null);
              }}
              className="px-2 py-0.5 rounded text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors"
              title="Quick set: last 7 days"
            >
              7d
            </button>
            <button
              onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 30);
                setFilterDateFrom(d.toISOString().split("T")[0]);
                setFilterDateTo(null);
              }}
              className="px-2 py-0.5 rounded text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors"
              title="Quick set: last 30 days"
            >
              30d
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        )}

        {/* Active filter pills */}
        {!showFilters && hasActiveFilters && (
          <div className="mt-1.5 flex items-center gap-1">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Filters ({[filterChannel, filterUnread && "unread", filterHasReply && "reply", (filterDateFrom || filterDateTo) && "date"].filter(Boolean).length})
            </span>
            <button onClick={clearFilters} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Virtualized thread list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground px-4">
            <Mail className="h-8 w-8 mb-3 opacity-40" />
            {hasActiveFilters || searchQuery ? (
              <>
                <p className="text-sm font-medium">No messages match your filters</p>
                <p className="text-xs mt-1 text-center">
                  Try clearing filters or expanding the date range.
                </p>
                <button
                  onClick={() => { clearFilters(); setSearchQuery(""); }}
                  className="mt-3 px-2.5 py-1 rounded text-[11px] border border-border hover:bg-accent transition-colors"
                >
                  Clear filters
                </button>
              </>
            ) : view === "ARCHIVED" ? (
              <>
                <p className="text-sm font-medium">Archive is empty</p>
                <p className="text-xs mt-1 text-center">
                  Older threads (before Jan 1, 2026) and archived conversations appear here.
                </p>
              </>
            ) : view === "SPAM" ? (
              <p className="text-sm font-medium">No spam</p>
            ) : view === "TRASH" ? (
              <p className="text-sm font-medium">Trash is empty</p>
            ) : (
              <>
                <p className="text-sm font-medium">No conversations yet</p>
                <p className="text-xs mt-1 text-center">
                  Connect an integration to start receiving messages, or click the refresh icon above to sync now.
                </p>
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= threads.length;

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center justify-center"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                );
              }

              const thread = threads[virtualRow.index];
              const name = thread.prospect.firstName || thread.prospect.lastName
                ? `${thread.prospect.firstName || ""} ${thread.prospect.lastName || ""}`.trim()
                : thread.prospect.email || "Unknown";

              return (
                <div
                  key={thread.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <button
                    onClick={() => setSelectedThread(thread.id)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors h-full relative",
                      selectedThreadId === thread.id
                        ? "bg-accent"
                        : "hover:bg-accent/60"
                    )}
                  >
                    {thread.isUnread && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary"
                        aria-hidden
                      />
                    )}
                    <div className="flex items-start gap-2.5">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5 ring-1 ring-inset",
                          thread.isUnread
                            ? "bg-primary/10 text-primary ring-primary/20"
                            : "bg-muted text-muted-foreground ring-border"
                        )}
                      >
                        {getInitials(thread.prospect.firstName, thread.prospect.lastName, thread.prospect.email)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={cn(
                                "text-sm truncate",
                                thread.isUnread
                                  ? "font-semibold text-foreground"
                                  : "text-foreground/90"
                              )}
                            >
                              {name}
                            </span>
                            {thread.channel === "LINKEDIN" ? (
                              <span className="shrink-0 w-3.5 h-3.5 rounded-sm flex items-center justify-center bg-teal-500/15 ring-1 ring-inset ring-teal-500/20">
                                <Send className="h-2 w-2 text-teal-600 dark:text-teal-300" />
                              </span>
                            ) : (
                              <span className="shrink-0 w-3.5 h-3.5 rounded-sm flex items-center justify-center bg-blue-500/15 ring-1 ring-inset ring-blue-500/25">
                                <Zap className="h-2 w-2 text-blue-600 dark:text-blue-300" />
                              </span>
                            )}
                          </div>
                          <span
                            className="text-[11px] text-muted-foreground shrink-0 tabular-nums"
                            title={thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleString() : ""}
                          >
                            {thread.lastMessageAt ? formatDate(thread.lastMessageAt) : ""}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          <span className="truncate">{thread.snippet || "No preview"}</span>
                        </p>
                        {(thread.threadLabels?.length > 0 || thread.prospect.company) && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {thread.threadLabels?.slice(0, 3).map(
                              (tl: { id: string; label: { name: string; color: string } }) => (
                                <span
                                  key={tl.id}
                                  className="text-[10px] px-1.5 py-0 h-[16px] inline-flex items-center rounded font-medium"
                                  style={{
                                    backgroundColor: `${tl.label.color}22`,
                                    color: tl.label.color,
                                    boxShadow: `inset 0 0 0 1px ${tl.label.color}40`,
                                  }}
                                >
                                  {tl.label.name}
                                </span>
                              )
                            )}
                            {thread.prospect.company && (
                              <span className="text-[11px] text-muted-foreground/80 truncate">
                                · {thread.prospect.company}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
