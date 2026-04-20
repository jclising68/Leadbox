"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useProspects } from "@/hooks/use-prospects";
import { useLabels } from "@/hooks/use-labels";
import { useInboxStore } from "@/stores/inbox-store";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useRouter, useParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Mail,
  Link2,
  Loader2,
  Zap,
  ArrowUpDown,
  Filter,
  X,
  Users,
  Copy,
  Send,
  Calendar,
  Check,
  Pencil,
} from "lucide-react";

type SortConfig = { field: string; dir: "asc" | "desc" };

const COLUMNS = [
  { key: "date", label: "Date", w: 95, sortable: true, sortField: "lastMessageAt" },
  { key: "source", label: "", w: 32, sortable: false, sortField: "" },
  { key: "firstName", label: "First Name", w: 110, sortable: true, sortField: "firstName" },
  { key: "lastName", label: "Last Name", w: 110, sortable: true, sortField: "lastName" },
  { key: "email", label: "Email", w: 200, sortable: true, sortField: "email" },
  { key: "phone", label: "Phone", w: 120, sortable: false, sortField: "" },
  { key: "title", label: "Title", w: 140, sortable: false, sortField: "" },
  { key: "company", label: "Company", w: 140, sortable: true, sortField: "company" },
  { key: "domain", label: "Domain", w: 130, sortable: true, sortField: "domain" },
  { key: "leadStatus", label: "Lead Status", w: 140, sortable: false, sortField: "" },
  { key: "campaign", label: "Campaign", w: 170, sortable: false, sortField: "" },
  { key: "step", label: "Step Replied", w: 100, sortable: false, sortField: "" },
  { key: "notes", label: "Notes", w: 140, sortable: false, sortField: "" },
  { key: "feedback", label: "Feedback", w: 140, sortable: false, sortField: "" },
];

const TOTAL_W = COLUMNS.reduce((s, c) => s + c.w, 0);

type WorkspaceLabel = { id: string; name: string; color: string };

function formatDate(date: string | null) {
  if (!date) return "-";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatFullDateTime(date: string | null) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CopyCell({ value, className }: { value: string; className?: string }) {
  if (!value || value === "-") return <span className={cn("text-muted-foreground", className)}>-</span>;
  return (
    <span className={cn("group/cell inline-flex items-center gap-1 max-w-full", className)}>
      <span className="truncate">{value}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(value);
          toast.success("Copied!");
        }}
        className="opacity-0 group-hover/cell:opacity-100 shrink-0 text-muted-foreground hover:text-foreground transition-opacity"
        title="Copy"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

function EditableCell({
  prospectId,
  field,
  value,
  className,
}: {
  prospectId: string;
  field: "notes" | "feedback";
  value: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();

  // Keep local value in sync with prop when not editing
  useEffect(() => {
    if (!editing) setLocalValue(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = useCallback(async () => {
    const trimmed = localValue.trim();
    // Nothing changed
    if (trimmed === (value || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/prospects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ id: prospectId, [field]: trimmed || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(err.error || "Failed to save");
      }
      toast.success(`${field === "notes" ? "Notes" : "Feedback"} saved`);
      // Invalidate to refetch fresh data
      await queryClient.invalidateQueries({ queryKey: ["prospects"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setLocalValue(value);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [localValue, value, workspaceId, prospectId, field, queryClient]);

  if (editing) {
    return (
      <div className="relative w-full h-full flex items-center" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={inputRef}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setLocalValue(value);
              setEditing(false);
            }
          }}
          className="w-full h-7 px-1.5 py-0.5 text-xs bg-background border border-primary/50 rounded resize-none outline-none focus:ring-1 focus:ring-primary/30"
          rows={1}
        />
        {saving && <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  const display = value || "";
  return (
    <span
      className={cn(
        "group/edit inline-flex items-center gap-1 max-w-full cursor-text",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title={display || `Click to add ${field}`}
    >
      <span className={cn("truncate", !display && "text-muted-foreground italic")}>
        {display || "-"}
      </span>
      {saving ? (
        <Check className="h-3 w-3 shrink-0 text-green-500" />
      ) : (
        <Pencil className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-opacity", display ? "opacity-0 group-hover/edit:opacity-100" : "opacity-40")} />
      )}
    </span>
  );
}

// Editable status dropdown for lead status — uses workspace labels dynamically
function StatusCell({
  prospectId,
  value,
  labels,
}: {
  prospectId: string;
  value: string;
  labels: WorkspaceLabel[];
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();

  const save = useCallback(async (newStatus: string) => {
    if (newStatus === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/prospects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ id: prospectId, leadStatus: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Status updated");
      await queryClient.invalidateQueries({ queryKey: ["prospects"] });
    } catch {
      toast.error("Failed to update status");
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }, [value, workspaceId, prospectId, queryClient]);

  const display = value || "";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 max-w-full cursor-pointer group/status"
        onClick={(e) => e.stopPropagation()}
      >
        {display ? (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-white truncate max-w-full"
            style={{ backgroundColor: labels.find((l) => l.name.toLowerCase() === display.toLowerCase())?.color || getStatusColor(display) }}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {display}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronDown className="h-3 w-3 opacity-40 group-hover/status:opacity-100" />
            Set status
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
        {labels.map((l) => (
          <DropdownMenuItem
            key={l.id}
            onClick={(e) => { e.stopPropagation(); save(l.name); }}
            className="text-xs"
          >
            <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: l.color }} />
            {l.name}
            {l.name.toLowerCase() === display.toLowerCase() && <Check className="h-3 w-3 ml-auto" />}
          </DropdownMenuItem>
        ))}
        {display && (
          <>
            <div className="border-t my-1" />
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); save(""); }}
              className="text-xs text-muted-foreground"
            >
              <X className="h-3 w-3 mr-2" /> Clear status
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Provider icon component - Instantly blue bolt, HeyReach teal/green hand-wave
function ProviderIcon({ provider, channel }: { provider: string | null; channel?: string | null }) {
  // Determine provider from explicit provider, or fall back to channel type
  const resolved = provider || (channel === "LINKEDIN" ? "HEYREACH" : channel === "EMAIL" ? "INSTANTLY" : null);
  if (!resolved) return <span className="text-muted-foreground text-[10px]">-</span>;

  if (resolved === "INSTANTLY") {
    return (
      <span title="Instantly" className="inline-flex items-center justify-center w-5 h-5 rounded-sm" style={{ backgroundColor: "rgba(59,130,246,0.15)" }}>
        <Zap className="h-3 w-3 text-blue-500" />
      </span>
    );
  }
  // HeyReach brand color: #00BFA6 (teal) with Send icon
  return (
    <span title="HeyReach" className="inline-flex items-center justify-center w-5 h-5 rounded-sm" style={{ backgroundColor: "rgba(0,191,166,0.15)" }}>
      <Send className="h-3 w-3" style={{ color: "#00BFA6" }} />
    </span>
  );
}

// Status badge color mapping
function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("interested") && !s.includes("not")) return "bg-green-500";
  if (s.includes("not interested")) return "bg-red-500";
  if (s.includes("meeting booked") || s.includes("meeting completed")) return "bg-emerald-500";
  if (s.includes("replied")) return "bg-blue-500";
  if (s.includes("bounced")) return "bg-red-400";
  if (s.includes("completed")) return "bg-gray-500";
  if (s.includes("in progress")) return "bg-yellow-500";
  if (s.includes("out of office")) return "bg-orange-400";
  if (s.includes("closed")) return "bg-emerald-600";
  return "bg-gray-400";
}

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>({ field: "lastMessageAt", dir: "desc" });
  const [labelFilter, setLabelFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const router = useRouter();
  const { setSelectedThread } = useInboxStore();
  const { data: labels } = useLabels();

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useProspects({
    search,
    sortBy: sort.field,
    sortDir: sort.dir,
    label: labelFilter,
    channel: channelFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    leadStatus: statusFilter,
  });

  const prospects = useMemo(
    () => data?.pages?.flatMap((p: { prospects: unknown[] }) => p.prospects) || [],
    [data]
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: prospects.length + (hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 20,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= prospects.length - 10 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualItems, prospects.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleSort = useCallback((field: string) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" }
    );
  }, []);

  const params = useParams();
  const slug = params.slug as string;

  const openThread = useCallback((threadId: string | null) => {
    if (threadId) {
      setSelectedThread(threadId);
      router.push(`/ws/${slug}/inbox`);
    }
  }, [setSelectedThread, router, slug]);

  const hasFilters = !!labelFilter || !!channelFilter || !!dateFrom || !!dateTo || !!statusFilter;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Lead Tracker</h1>
            <span className="text-sm text-muted-foreground">
              {prospects.length}{hasNextPage ? "+" : ""} contacts
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, company, domain..."
              className="pl-9 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors",
              channelFilter ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted"
            )}>
              <Filter className="h-3.5 w-3.5" />
              {channelFilter || "Channel"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setChannelFilter("")}>All</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChannelFilter("EMAIL")}>
                <Mail className="h-3.5 w-3.5 mr-2" /> Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChannelFilter("LINKEDIN")}>
                <Link2 className="h-3.5 w-3.5 mr-2" /> LinkedIn
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors",
              labelFilter ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted"
            )}>
              <Filter className="h-3.5 w-3.5" />
              {labelFilter || "Label"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setLabelFilter("")}>All labels</DropdownMenuItem>
              {labels?.map((l: { id: string; name: string; color: string }) => (
                <DropdownMenuItem key={l.id} onClick={() => setLabelFilter(l.name)}>
                  <span className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: l.color }} />
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors",
              statusFilter ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted"
            )}>
              <Filter className="h-3.5 w-3.5" />
              {statusFilter || "Status"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setStatusFilter("")}>All statuses</DropdownMenuItem>
              {(labels || []).map((l: WorkspaceLabel) => (
                <DropdownMenuItem key={l.id} onClick={() => setStatusFilter(l.name)}>
                  <span className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: l.color }} />
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors",
              (dateFrom || dateTo) ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted"
            )}>
              <Calendar className="h-3.5 w-3.5" />
              {dateFrom && dateTo ? `${dateFrom} - ${dateTo}` : dateFrom ? `From ${dateFrom}` : "Date"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => { setDateFrom(""); setDateTo(""); }}>All time</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 7);
                setDateFrom(d.toISOString().split("T")[0]); setDateTo(new Date().toISOString().split("T")[0]);
              }}>Last 7 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 30);
                setDateFrom(d.toISOString().split("T")[0]); setDateTo(new Date().toISOString().split("T")[0]);
              }}>Last 30 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 90);
                setDateFrom(d.toISOString().split("T")[0]); setDateTo(new Date().toISOString().split("T")[0]);
              }}>Last 90 days</DropdownMenuItem>
              <div className="border-t my-1" />
              <div className="px-3 py-2 space-y-3">
                <span className="text-xs font-medium text-muted-foreground">Custom range</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Start date</label>
                    <input type="date" className="w-full text-xs bg-background border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">End date</label>
                    <input type="date" className="w-full text-xs bg-background border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </div>
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilters && (
            <button
              onClick={() => { setLabelFilter(""); setChannelFilter(""); setDateFrom(""); setDateTo(""); setStatusFilter(""); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table — single scroll container so header + body scroll together */}
      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        {/* Sticky header */}
        <div
          className="flex items-center border-b bg-muted/30 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm bg-background/95"
          style={{ minWidth: `${TOTAL_W}px` }}
        >
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className={cn(
                "shrink-0 px-3 flex items-center gap-1",
                col.sortable && "cursor-pointer hover:text-foreground select-none"
              )}
              style={{ width: `${col.w}px` }}
              onClick={() => col.sortable && toggleSort(col.sortField)}
            >
              {col.label}
              {col.sortable && sort.field === col.sortField && (
                sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
              )}
              {col.sortable && sort.field !== col.sortField && col.label && (
                <ArrowUpDown className="h-3 w-3 opacity-30" />
              )}
            </div>
          ))}
        </div>

        {/* Table body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No leads found</p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              minWidth: `${TOTAL_W}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              if (virtualRow.index >= prospects.length) {
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

              const p = prospects[virtualRow.index] as Record<string, unknown>;
              const thread = p.thread as Record<string, unknown> | null;
              const threadLabels = (thread?.threadLabels || []) as {
                label: { id: string; name: string; color: string };
              }[];
              const latestMsg = ((thread?.messages || []) as Record<string, unknown>[])[0];
              const provider = (latestMsg?.integration as { provider: string } | null)?.provider || null;
              const channel = (thread?.channel as string) || null;

              // Use lastMessageAt (actual interaction date) > sourceDate > createdAt
              const displayDate = (thread?.lastMessageAt as string)
                || (p.sourceDate as string)
                || (p.createdAt as string);

              return (
                <div
                  key={p.id as string}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    minWidth: `${TOTAL_W}px`,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center border-b text-sm transition-colors cursor-pointer",
                    "hover:bg-muted/50",
                    thread && (thread as Record<string, unknown>).isUnread ? "bg-primary/[0.02]" : ""
                  )}
                  onClick={() => openThread(thread?.id as string | null)}
                >
                  {/* Date */}
                  <div className="shrink-0 px-3 text-xs text-muted-foreground" style={{ width: `${COLUMNS[0].w}px` }}>
                    <span title={formatFullDateTime(displayDate)}>{formatDate(displayDate)}</span>
                  </div>

                  {/* Provider icon */}
                  <div className="shrink-0 px-1 flex items-center justify-center" style={{ width: `${COLUMNS[1].w}px` }}>
                    <ProviderIcon provider={provider} channel={channel} />
                  </div>

                  {/* First Name */}
                  <div className="shrink-0 px-3 text-xs" style={{ width: `${COLUMNS[2].w}px` }}>
                    <CopyCell value={(p.firstName as string) || "-"} />
                  </div>

                  {/* Last Name */}
                  <div className="shrink-0 px-3 text-xs" style={{ width: `${COLUMNS[3].w}px` }}>
                    <CopyCell value={(p.lastName as string) || "-"} />
                  </div>

                  {/* Email */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[4].w}px` }}>
                    <CopyCell value={(p.email as string) || "-"} />
                  </div>

                  {/* Phone */}
                  <div className="shrink-0 px-3 text-xs" style={{ width: `${COLUMNS[5].w}px` }}>
                    <CopyCell value={(p.phone as string) || "-"} />
                  </div>

                  {/* Title */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[6].w}px` }}>
                    <CopyCell value={(p.title as string) || "-"} />
                  </div>

                  {/* Company */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[7].w}px` }}>
                    <CopyCell value={(p.company as string) || "-"} />
                  </div>

                  {/* Domain */}
                  <div className="shrink-0 px-3 text-xs truncate text-muted-foreground" style={{ width: `${COLUMNS[8].w}px` }}>
                    <CopyCell value={(p.domain as string) || "-"} />
                  </div>

                  {/* Lead Status — editable dropdown */}
                  <div className="shrink-0 px-3 flex items-center gap-1 overflow-hidden" style={{ width: `${COLUMNS[9].w}px` }}>
                    <StatusCell
                      prospectId={p.id as string}
                      value={(p.leadStatus as string) || (threadLabels[0]?.label?.name || "")}
                      labels={labels || []}
                    />
                  </div>

                  {/* Campaign */}
                  <div className="shrink-0 px-3 text-xs truncate text-muted-foreground" style={{ width: `${COLUMNS[10].w}px` }}>
                    <CopyCell value={(p.campaignName as string) || (latestMsg?.campaignName as string) || "-"} />
                  </div>

                  {/* Step Replied */}
                  <div className="shrink-0 px-3 text-xs text-muted-foreground" style={{ width: `${COLUMNS[11].w}px` }}>
                    {(p.stepReplied as string) || "-"}
                  </div>

                  {/* Notes */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[12].w}px` }}>
                    <EditableCell
                      prospectId={p.id as string}
                      field="notes"
                      value={(p.notes as string) || ""}
                      className="text-muted-foreground"
                    />
                  </div>

                  {/* Feedback */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[13].w}px` }}>
                    <EditableCell
                      prospectId={p.id as string}
                      field="feedback"
                      value={(p.feedback as string) || ""}
                      className="text-muted-foreground"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
