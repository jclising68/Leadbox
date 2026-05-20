"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useProspects } from "@/hooks/use-prospects";
import { useLabels } from "@/hooks/use-labels";
import { useInboxStore } from "@/stores/inbox-store";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useRouter, useParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnrichDialog, type EnrichDialogProspect } from "@/components/leads/enrich-dialog";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Mail,
  Loader2,
  ArrowUpDown,
  Filter,
  X,
  Users,
  Copy,
  Calendar,
  Check,
  Pencil,
  Sparkles,
  Ban,
  Trash2,
  Download,
} from "lucide-react";

// Field-key shape for the source map; mirrors EnrichField in services/enrichment.ts.
type EnrichFieldKey = "phone" | "title" | "linkedinUrl" | "verifiedEmail" | "company";
type EnrichSource = "BLITZ" | "APOLLO" | "NOT_FOUND";
type EnrichmentSourceMap = Partial<Record<EnrichFieldKey, EnrichSource>>;

type SortConfig = { field: string; dir: "asc" | "desc" };

// Returns "YYYY-MM-DD" in the client's local timezone (avoids UTC offset bugs
// that toISOString() introduces for UTC+ locales).
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COLUMNS = [
  { key: "select", label: "", w: 36, sortable: false, sortField: "" },
  { key: "date", label: "Date", w: 95, sortable: true, sortField: "lastMessageAt" },
  { key: "source", label: "", w: 32, sortable: false, sortField: "" },
  { key: "firstName", label: "First Name", w: 110, sortable: true, sortField: "firstName" },
  { key: "lastName", label: "Last Name", w: 110, sortable: true, sortField: "lastName" },
  { key: "email", label: "Email", w: 200, sortable: true, sortField: "email" },
  { key: "phone", label: "Phone", w: 120, sortable: false, sortField: "" },
  { key: "title", label: "Title", w: 140, sortable: false, sortField: "" },
  { key: "linkedinUrl", label: "LinkedIn", w: 160, sortable: false, sortField: "" },
  { key: "company", label: "Company", w: 140, sortable: true, sortField: "company" },
  { key: "domain", label: "Domain", w: 130, sortable: true, sortField: "domain" },
  { key: "leadStatus", label: "Lead Status", w: 140, sortable: false, sortField: "" },
  { key: "campaign", label: "Campaign", w: 170, sortable: false, sortField: "" },
  { key: "step", label: "Step Replied", w: 100, sortable: false, sortField: "" },
  { key: "notes", label: "Notes", w: 140, sortable: false, sortField: "" },
  { key: "feedback", label: "Feedback", w: 140, sortable: false, sortField: "" },
];

// Tiny B (Blitz) / A (Apollo) provenance badge rendered next to enriched cell
// values. Helps the user spot-check which fields came from which provider.
function SourceBadge({ source }: { source: EnrichSource | undefined }) {
  if (source !== "BLITZ" && source !== "APOLLO") return null;
  const isBlitz = source === "BLITZ";
  return (
    <span
      title={`Enriched via ${isBlitz ? "Blitz" : "Apollo"}`}
      className={cn(
        "inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-[8px] font-bold shrink-0 ml-1",
        isBlitz
          ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 ring-1 ring-inset ring-blue-500/25"
          : "bg-purple-500/15 text-purple-600 dark:text-purple-300 ring-1 ring-inset ring-purple-500/25",
      )}
    >
      {isBlitz ? "B" : "A"}
    </span>
  );
}

// Cell renderer that handles three states:
//   1. Has value → render with optional source badge (CopyCell-style)
//   2. NOT_FOUND  → render "No data available" with ⊘ icon
//   3. Missing, never tried → render "-" placeholder
function EnrichableCell({
  value,
  source,
  className,
  copyable = true,
  href,
}: {
  value: string | null | undefined;
  source: EnrichSource | undefined;
  className?: string;
  copyable?: boolean;
  /** When set, wraps the value in an external link (used by LinkedIn URL column). */
  href?: string | null;
}) {
  const hasValue = value && value !== "-" && value.trim() !== "";

  if (hasValue) {
    const display = href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="truncate text-primary hover:underline"
        title={href}
      >
        {value}
      </a>
    ) : (
      <span className="truncate">{value}</span>
    );
    return (
      <span className={cn("group/cell inline-flex items-center gap-1 max-w-full", className)}>
        {display}
        <SourceBadge source={source} />
        {copyable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(href || value!);
              toast.success("Copied!");
            }}
            className="opacity-0 group-hover/cell:opacity-100 shrink-0 text-muted-foreground hover:text-foreground transition-opacity"
            title="Copy"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  if (source === "NOT_FOUND") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-muted-foreground/60 italic", className)}
        title="Searched both providers — no data available"
      >
        <Ban className="h-3 w-3 shrink-0" />
        <span className="truncate text-[11px]">No data available</span>
      </span>
    );
  }

  return <span className={cn("text-muted-foreground/60", className)}>-</span>;
}

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
  if (!value || value === "-") return <span className={cn("text-muted-foreground/60", className)}>-</span>;
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
  field: "notes" | "feedback" | "campaignName";
  value: string;
  className?: string;
}) {
  const fieldLabel = field === "notes" ? "Notes" : field === "feedback" ? "Feedback" : "Campaign";
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
      toast.success(`${fieldLabel} saved`);
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
          className="w-full h-7 px-1.5 py-0.5 text-xs bg-background text-foreground border border-input rounded-md resize-none outline-none focus:ring-2 focus:ring-ring/40"
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
      title={display || `Click to add ${fieldLabel.toLowerCase()}`}
    >
      <span className={cn("truncate", !display && "text-muted-foreground italic")}>
        {display || "-"}
      </span>
      {saving ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
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
      const result = await res.json();
      const sync = result.providerSync;
      if (sync?.ok) {
        toast.success(`Tag updated & synced to ${sync.provider}`);
      } else if (sync && !sync.ok) {
        toast.success("Tag updated locally", { description: `${sync.provider} sync: ${sync.error}` });
      } else {
        toast.success("Tag updated");
      }
      // Invalidate both prospects and threads so inbox reflects the change
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["prospects"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
      ]);
    } catch {
      toast.error("Failed to update status");
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }, [value, workspaceId, prospectId, queryClient]);

  const display = value || "";
  // Only show as a colored badge if the status matches a workspace label.
  // Campaign statuses like "In Progress" or "Replied" that aren't workspace
  // labels show the "Set tag" placeholder instead.
  const matchedLabel = display
    ? labels.find((l) => l.name.toLowerCase() === display.toLowerCase())
    : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 max-w-full cursor-pointer group/status"
        onClick={(e) => e.stopPropagation()}
      >
        {matchedLabel ? (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-full"
            style={{
              backgroundColor: `${matchedLabel.color}22`,
              color: matchedLabel.color,
              boxShadow: `inset 0 0 0 1px ${matchedLabel.color}40`,
            }}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {matchedLabel.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors">
            <ChevronDown className="h-3 w-3" />
            Set tag
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
        {matchedLabel && (
          <>
            <div className="border-t border-border my-1" />
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); save(""); }}
              className="text-xs text-muted-foreground"
            >
              <X className="h-3 w-3 mr-2" /> Clear tag
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PROVIDER_LOGOS: Record<string, { src: string; label: string }> = {
  INSTANTLY: { src: "/branding/instantly.png", label: "Instantly" },
  HEYREACH:  { src: "/branding/heyreach.png",  label: "HeyReach" },
  LEMLIST:   { src: "/branding/lemlist.svg",   label: "Lemlist" },
};

function ProviderIcon({ provider, channel }: { provider: string | null; channel?: string | null }) {
  const resolved = provider || (channel === "LINKEDIN" ? "HEYREACH" : null);
  const meta = resolved ? PROVIDER_LOGOS[resolved] : null;
  if (!meta) return <span className="text-muted-foreground/60 text-[10px]">-</span>;
  return (
    <span
      title={meta.label}
      className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-white border border-border overflow-hidden"
    >
      <Image src={meta.src} alt={meta.label} width={16} height={16} className="object-contain" />
    </span>
  );
}

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>({ field: "lastMessageAt", dir: "desc" });
  const [labelFilter, setLabelFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [showUnsubscribed, setShowUnsubscribed] = useState(false);
  const [replyProspect, setReplyProspect] = useState<Record<string, unknown> | null>(null);
  const [replyMessages, setReplyMessages] = useState<Record<string, unknown>[]>([]);
  const [replyLoading, setReplyLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichDialogOpen, setEnrichDialogOpen] = useState(false);
  const router = useRouter();
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const { setSelectedThread, setView, setSelectedLabel, clearFilters: clearInboxFilters } = useInboxStore();
  const { data: labels } = useLabels();

  // Whether this workspace has Blitz / Apollo configured. Drives the
  // Enrich button's disabled state and the dialog's submit-ability.
  const { data: integrations } = useQuery({
    queryKey: ["integrations", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [] as { provider: string; isActive: boolean }[];
      const res = await fetch("/api/integrations", {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });
  const hasBlitz = useMemo(
    () => (integrations ?? []).some((i: { provider: string; isActive: boolean }) => i.provider === "BLITZ" && i.isActive),
    [integrations],
  );
  const hasApollo = useMemo(
    () => (integrations ?? []).some((i: { provider: string; isActive: boolean }) => i.provider === "APOLLO" && i.isActive),
    [integrations],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleUnsubscribe = useCallback(async (prospectId: string, currentlyUnsubscribed: boolean) => {
    const action = currentlyUnsubscribed ? "resubscribe" : "unsubscribe";
    try {
      const res = await fetch(`/api/prospects/${prospectId}/${action}`, {
        method: "POST",
        headers: workspaceId ? { "x-workspace-id": workspaceId } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }
      if (currentlyUnsubscribed) {
        toast.success("Contact re-subscribed");
      } else {
        const data = await res.json().catch(() => ({}));
        const sync = data?.instantlySync;
        if (sync?.status === "ok") {
          toast.success("Unsubscribed and synced to Instantly");
        } else if (sync?.status === "failed") {
          toast.warning(`Unsubscribed in LeadBox — Instantly sync failed: ${sync.reason}`);
        } else {
          // skipped — HeyReach contact or no campaign ID
          toast.success("Contact unsubscribed (LinkedIn/HeyReach contact — no Instantly sync needed)");
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["prospects"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }, [workspaceId, queryClient]);

  const handleBulkUnsubscribe = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/prospects/${id}/unsubscribe`, {
          method: "POST",
          headers: workspaceId ? { "x-workspace-id": workspaceId } : {},
        })
      )
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    if (succeeded > 0) toast.success(`${succeeded} contact${succeeded === 1 ? "" : "s"} unsubscribed`);
    if (failed > 0) toast.error(`${failed} failed`);
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ["prospects"] });
  }, [selectedIds, workspaceId, queryClient]);

  const handleTrashThread = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) },
        body: JSON.stringify({ status: "TRASH" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Moved to trash");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["prospects"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
      ]);
    } catch {
      toast.error("Failed to move to trash");
    }
  }, [workspaceId, queryClient]);


  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useProspects({
    search,
    sortBy: sort.field,
    sortDir: sort.dir,
    label: labelFilter,
    provider: providerFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    leadStatus: statusFilter,
    showUnsubscribed,
  });

  const prospects = useMemo(
    () => data?.pages?.flatMap((p: { prospects: unknown[] }) => p.prospects) || [],
    [data]
  );

  const handleBulkTrash = useCallback(async () => {
    const selected = Array.from(selectedIds);
    const threadIds = selected
      .map((id) => {
        const p = prospects.find((pp) => (pp as { id: string }).id === id) as { thread?: { id?: string } } | undefined;
        return p?.thread?.id;
      })
      .filter(Boolean) as string[];
    if (threadIds.length === 0) return;
    const results = await Promise.allSettled(
      threadIds.map((tid) =>
        fetch(`/api/threads/${tid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) },
          body: JSON.stringify({ status: "TRASH" }),
        })
      )
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    if (succeeded > 0) toast.success(`${succeeded} contact${succeeded === 1 ? "" : "s"} moved to trash`);
    if (failed > 0) toast.error(`${failed} failed`);
    setSelectedIds(new Set());
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["prospects"] }),
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
    ]);
  }, [selectedIds, prospects, workspaceId, queryClient]);

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

  const handleExportCsv = useCallback(() => {
    const headers = ["Date", "First Name", "Last Name", "Email", "Phone", "Title", "LinkedIn", "Company", "Domain", "Lead Status", "Campaign", "Label"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (prospects as Record<string, unknown>[]).map((p) => {
      const thread = p.thread as Record<string, unknown> | null;
      const lastMsgAt = (thread?.lastMessageAt ?? p.lastMessageAt) as string | null;
      const date = lastMsgAt ? new Date(lastMsgAt).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "";
      const latestMsg = ((thread?.messages || []) as Record<string, unknown>[])[0];
      const campaign = (p.campaignName as string) || (latestMsg?.campaignName as string) || "";
      const label = (() => {
        const tl = (thread?.threadLabels as { label: { name: string } }[] | undefined) ?? [];
        return tl.map((l) => l.label.name).join("; ");
      })();
      return [
        date,
        p.firstName,
        p.lastName,
        p.email,
        p.phone,
        p.title,
        p.linkedinUrl,
        p.company,
        p.domain,
        p.leadStatus,
        campaign,
        label,
      ].map(escape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [prospects]);

  const params = useParams();
  const slug = params.slug as string;

  const openThread = useCallback((threadId: string | null) => {
    if (threadId) {
      // Set view to ALL and clear inbox filters so the thread is visible
      // regardless of its status or labels.
      setView("ALL");
      setSelectedLabel(null);
      clearInboxFilters();
      setSelectedThread(threadId);
      router.push(`/ws/${slug}/inbox`);
    }
  }, [setSelectedThread, setView, setSelectedLabel, clearInboxFilters, router, slug]);

  const openReplyPopup = useCallback(async (prospect: Record<string, unknown>) => {
    const thread = prospect.thread as Record<string, unknown> | null;
    if (!thread?.id) return;
    setReplyProspect(prospect);
    setReplyMessages([]);
    setReplyLoading(true);
    try {
      const res = await fetch(`/api/threads/${thread.id}`, {
        headers: {
          "x-workspace-id": workspaceId || "",
        },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setReplyMessages((data.messages || []) as Record<string, unknown>[]);
      }
    } catch {
      // silently fail - dialog will show empty
    } finally {
      setReplyLoading(false);
    }
  }, [workspaceId]);

  const hasFilters = !!labelFilter || !!dateFrom || !!dateTo || !!statusFilter || !!providerFilter;
  const activeFilterCount = [!!labelFilter, !!statusFilter, !!(dateFrom || dateTo), !!providerFilter, showUnsubscribed].filter(Boolean).length;

  const filterTriggerBase =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40";
  const filterTriggerIdle =
    "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground";
  const filterTriggerActive =
    "bg-primary/10 border-primary/30 text-foreground";

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 bg-background">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Lead Tracker</h1>
            <span className="text-sm text-muted-foreground tabular-nums">
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
              className="pl-9 h-9 bg-card border-input"
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

          {/* Single unified Filters button */}
          <Popover>
            <PopoverTrigger
              className={cn(
                filterTriggerBase,
                hasFilters || showUnsubscribed ? filterTriggerActive : filterTriggerIdle
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className="h-3 w-3 opacity-70" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0" sideOffset={6}>
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-medium">Filters</span>
                <button
                  onClick={() => { setLabelFilter(""); setDateFrom(""); setDateTo(""); setStatusFilter(""); setProviderFilter(""); setShowUnsubscribed(false); }}
                  className={cn(
                    "text-xs transition-colors",
                    hasFilters || showUnsubscribed
                      ? "text-primary hover:text-primary/80"
                      : "text-muted-foreground/40 cursor-default pointer-events-none"
                  )}
                >
                  Clear all
                </button>
              </div>

              {/* Label */}
              <div className="p-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Label</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setLabelFilter("")}
                    className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-md text-xs border transition-colors",
                      !labelFilter
                        ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                        : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    All
                  </button>
                  {(labels || []).map((l: WorkspaceLabel) => (
                    <button
                      key={l.id}
                      onClick={() => setLabelFilter(labelFilter === l.name ? "" : l.name)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors",
                        labelFilter === l.name
                          ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                          : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="p-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setStatusFilter("")}
                    className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-md text-xs border transition-colors",
                      !statusFilter
                        ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                        : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    All
                  </button>
                  {(labels || []).map((l: WorkspaceLabel) => (
                    <button
                      key={l.id}
                      onClick={() => setStatusFilter(statusFilter === l.name ? "" : l.name)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors",
                        statusFilter === l.name
                          ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                          : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div className="p-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Date</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { label: "All time", days: 0 },
                    { label: "Last 7 days", days: 7 },
                    { label: "Last 30 days", days: 30 },
                    { label: "Last 90 days", days: 90 },
                  ].map((opt) => {
                    const isActive = opt.days === 0 ? !dateFrom && !dateTo : (() => {
                      const d = new Date(); d.setDate(d.getDate() - opt.days);
                      return dateFrom === localDateStr(d);
                    })();
                    return (
                      <button
                        key={opt.label}
                        onClick={() => {
                          if (opt.days === 0) { setDateFrom(""); setDateTo(""); }
                          else {
                            const d = new Date(); d.setDate(d.getDate() - opt.days);
                            setDateFrom(localDateStr(d));
                            setDateTo(localDateStr(new Date()));
                          }
                        }}
                        className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-md text-xs border transition-colors",
                          isActive
                            ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                            : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  {(() => {
                    const now = new Date();
                    const mtdFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
                    const today = localDateStr(now);
                    const isActive = dateFrom === mtdFrom && dateTo === today;
                    return (
                      <button
                        onClick={() => { setDateFrom(mtdFrom); setDateTo(today); }}
                        className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-md text-xs border transition-colors",
                          isActive
                            ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                            : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        )}
                      >
                        Month to date
                      </button>
                    );
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">From</label>
                    <input
                      type="date"
                      className="w-full text-xs bg-background text-foreground border border-input rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">To</label>
                    <input
                      type="date"
                      className="w-full text-xs bg-background text-foreground border border-input rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Source */}
              <div className="p-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Source</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: "INSTANTLY", src: "/branding/instantly.png", label: "Instantly" },
                    { value: "HEYREACH",  src: "/branding/heyreach.png",  label: "HeyReach" },
                    { value: "LEMLIST",   src: "/branding/lemlist.svg",   label: "Lemlist" },
                  ].map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setProviderFilter(providerFilter === p.value ? "" : p.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors",
                        providerFilter === p.value
                          ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                          : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                    >
                      <Image src={p.src} alt={p.label} width={12} height={12} className="object-contain" />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unsubscribed */}
              <div className="p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Contacts</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowUnsubscribed(false)}
                    className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-md text-xs border transition-colors",
                      !showUnsubscribed
                        ? "bg-primary/10 border-primary/30 text-foreground font-medium"
                        : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => setShowUnsubscribed(true)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors",
                      showUnsubscribed
                        ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400 font-medium"
                        : "bg-card border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <Ban className="h-3 w-3" />
                    Unsubscribed only
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {(hasFilters || showUnsubscribed) && (
            <button
              onClick={() => { setLabelFilter(""); setDateFrom(""); setDateTo(""); setStatusFilter(""); setProviderFilter(""); setShowUnsubscribed(false); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}

          <button
            onClick={handleExportCsv}
            disabled={prospects.length === 0}
            className={cn(
              filterTriggerBase,
              "ml-auto",
              prospects.length === 0
                ? "opacity-40 cursor-not-allowed border-border text-muted-foreground"
                : filterTriggerIdle
            )}
            title={`Export ${prospects.length} contact${prospects.length === 1 ? "" : "s"} as CSV`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
            {prospects.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">({prospects.length})</span>
            )}
          </button>

          {selectedIds.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              {!hasBlitz && !hasApollo && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                  title="No enrichment provider configured for this workspace"
                >
                  <Ban className="h-3 w-3" />
                  Setup needed
                </span>
              )}
              <button
                onClick={handleBulkTrash}
                title={`Move ${selectedIds.size} selected contact${selectedIds.size === 1 ? "" : "s"} to trash`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-muted border border-border text-muted-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Trash {selectedIds.size}
              </button>
              <button
                onClick={handleBulkUnsubscribe}
                title={`Unsubscribe ${selectedIds.size} selected contact${selectedIds.size === 1 ? "" : "s"}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-500/20"
              >
                <Ban className="h-3.5 w-3.5" />
                Unsubscribe {selectedIds.size}
              </button>
              <button
                onClick={() => setEnrichDialogOpen(true)}
                title={
                  !hasBlitz && !hasApollo
                    ? "Click to see setup instructions"
                    : `Enrich ${selectedIds.size} selected lead${selectedIds.size === 1 ? "" : "s"}`
                }
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  hasBlitz || hasApollo
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Enrich {selectedIds.size}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table — single scroll container so header + body scroll together */}
      <div ref={parentRef} className="flex-1 overflow-auto min-h-0 bg-background">
        {/* Sticky header */}
        <div
          className="flex items-center border-b border-border py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide sticky top-0 z-10 backdrop-blur bg-card/95 supports-[backdrop-filter]:bg-card/80"
          style={{ minWidth: `${TOTAL_W}px` }}
        >
          {COLUMNS.map((col) => {
            // Select column gets a select-all checkbox instead of a label.
            if (col.key === "select") {
              const allSelected =
                prospects.length > 0 &&
                prospects.every((pp) => selectedIds.has((pp as { id: string }).id));
              const someSelected = selectedIds.size > 0 && !allSelected;
              return (
                <div
                  key={col.key}
                  className="shrink-0 px-2 flex items-center justify-center"
                  style={{ width: `${col.w}px` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={allSelected || someSelected}
                    onCheckedChange={() => {
                      setSelectedIds((prev) => {
                        if (allSelected) return new Set();
                        const next = new Set(prev);
                        for (const pp of prospects) next.add((pp as { id: string }).id);
                        return next;
                      });
                    }}
                  />
                </div>
              );
            }
            return (
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
                  <ArrowUpDown className="h-3 w-3 opacity-40" />
                )}
              </div>
            );
          })}
        </div>

        {/* Table body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">{hasFilters ? "No leads match your filters" : "No leads yet"}</p>
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
                source: string;
              }[];
              const latestMsg = ((thread?.messages || []) as Record<string, unknown>[])[0];
              const provider = (latestMsg?.integration as { provider: string } | null)?.provider || null;
              const channel = (thread?.channel as string) || null;

              // Use lastMessageAt (actual interaction date) > sourceDate > createdAt
              const displayDate = (thread?.lastMessageAt as string)
                || (p.sourceDate as string)
                || (p.createdAt as string);

              const stepReplied = (p.stepReplied as string) || "";
              const enrichmentSource = (p.enrichmentSource as EnrichmentSourceMap) ?? {};
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
                    "flex items-center border-b border-border/60 text-sm transition-colors cursor-pointer text-foreground/90",
                    "hover:bg-accent/40",
                    p.isUnsubscribed ? "opacity-60" : "",
                    !p.isUnsubscribed && thread && (thread as Record<string, unknown>).isUnread ? "bg-primary/[0.04]" : ""
                  )}
                  onClick={() => openReplyPopup(p)}
                >
                  {/* Selection checkbox */}
                  <div
                    className="shrink-0 px-2 flex items-center justify-center"
                    style={{ width: `${COLUMNS[0].w}px` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(p.id as string)}
                      onCheckedChange={() => toggleSelected(p.id as string)}
                    />
                  </div>

                  {/* Date */}
                  <div className="shrink-0 px-3 text-xs text-muted-foreground tabular-nums" style={{ width: `${COLUMNS[1].w}px` }}>
                    <span title={formatFullDateTime(displayDate)}>{formatDate(displayDate)}</span>
                  </div>

                  {/* Provider icon */}
                  <div className="shrink-0 px-1 flex items-center justify-center" style={{ width: `${COLUMNS[2].w}px` }}>
                    <ProviderIcon provider={provider} channel={channel} />
                  </div>

                  {/* First Name */}
                  <div className="shrink-0 px-3 text-xs" style={{ width: `${COLUMNS[3].w}px` }}>
                    <CopyCell value={(p.firstName as string) || "-"} />
                  </div>

                  {/* Last Name */}
                  <div className="shrink-0 px-3 text-xs" style={{ width: `${COLUMNS[4].w}px` }}>
                    <CopyCell value={(p.lastName as string) || "-"} />
                  </div>

                  {/* Email */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[5].w}px` }}>
                    <EnrichableCell
                      value={p.email as string | null | undefined}
                      source={enrichmentSource.verifiedEmail}
                    />
                  </div>

                  {/* Phone */}
                  <div className="shrink-0 px-3 text-xs tabular-nums" style={{ width: `${COLUMNS[6].w}px` }}>
                    <EnrichableCell
                      value={p.phone as string | null | undefined}
                      source={enrichmentSource.phone}
                    />
                  </div>

                  {/* Title */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[7].w}px` }}>
                    <EnrichableCell
                      value={p.title as string | null | undefined}
                      source={enrichmentSource.title}
                    />
                  </div>

                  {/* LinkedIn URL */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[8].w}px` }}>
                    {(() => {
                      const url = p.linkedinUrl as string | null | undefined;
                      // Strip the boilerplate prefix so the cell shows the
                      // useful identifier (e.g. "in/john-doe") rather than
                      // truncating "https://www.linkedin.c...".
                      const display = url
                        ? url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").replace(/\/$/, "")
                        : url;
                      return (
                        <EnrichableCell
                          value={display}
                          source={enrichmentSource.linkedinUrl}
                          href={url}
                        />
                      );
                    })()}
                  </div>

                  {/* Company */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[9].w}px` }}>
                    <EnrichableCell
                      value={p.company as string | null | undefined}
                      source={enrichmentSource.company}
                    />
                  </div>

                  {/* Domain */}
                  <div className="shrink-0 px-3 text-xs truncate text-muted-foreground" style={{ width: `${COLUMNS[10].w}px` }}>
                    <CopyCell value={(p.domain as string) || "-"} />
                  </div>

                  {/* Lead Status — editable dropdown */}
                  <div className="shrink-0 px-3 flex items-center gap-1 overflow-hidden" style={{ width: `${COLUMNS[11].w}px` }}>
                    <StatusCell
                      prospectId={p.id as string}
                      value={(() => {
                        // Priority: manual leadStatus field (user-set) → threadLabel by source priority
                        const ls = (p.leadStatus as string) || "";
                        const wsLabels = labels || [];
                        if (ls && wsLabels.some((l: WorkspaceLabel) => l.name.toLowerCase() === ls.toLowerCase())) {
                          return ls;
                        }
                        // Mirror inbox: show the most authoritative label regardless of source.
                        // MANUAL wins, then WEBHOOK (Instantly status), then AUTO_AI.
                        const label =
                          threadLabels.find((tl) => tl.source === "MANUAL") ||
                          threadLabels.find((tl) => tl.source === "WEBHOOK") ||
                          threadLabels.find((tl) => tl.source === "AUTO_AI");
                        return label?.label?.name || "";
                      })()}
                      labels={labels || []}
                    />
                  </div>

                  {/* Campaign — manual override of the message-derived value
                      so users can fill it in when no provider data fetched. */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[12].w}px` }}>
                    <EditableCell
                      prospectId={p.id as string}
                      field="campaignName"
                      value={(p.campaignName as string) || (latestMsg?.campaignName as string) || ""}
                      className="text-muted-foreground"
                    />
                  </div>

                  {/* Step Replied */}
                  <div
                    className={cn(
                      "shrink-0 px-3 text-xs tabular-nums",
                      stepReplied ? "text-muted-foreground" : "text-muted-foreground/60"
                    )}
                    style={{ width: `${COLUMNS[13].w}px` }}
                  >
                    {stepReplied || "-"}
                  </div>

                  {/* Notes */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[14].w}px` }}>
                    <EditableCell
                      prospectId={p.id as string}
                      field="notes"
                      value={(p.notes as string) || ""}
                      className="text-muted-foreground"
                    />
                  </div>

                  {/* Feedback */}
                  <div className="shrink-0 px-3 text-xs truncate" style={{ width: `${COLUMNS[15].w}px` }}>
                    <EditableCell
                      prospectId={p.id as string}
                      field="feedback"
                      value={(p.feedback as string) || ""}
                      className="text-muted-foreground"
                    />
                  </div>

                  {/* Unsubscribe action — faint by default, full color on hover */}
                  <div
                    className="shrink-0 px-2 flex items-center justify-center"
                    style={{ width: "36px" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleUnsubscribe(p.id as string, p.isUnsubscribed as boolean)}
                      title={p.isUnsubscribed ? "Re-subscribe contact" : "Unsubscribe contact"}
                      className={cn(
                        "p-1 rounded transition-colors",
                        p.isUnsubscribed
                          ? "text-red-500 hover:bg-red-500/10"
                          : "text-muted-foreground/25 hover:text-red-500 hover:bg-red-500/10"
                      )}
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Trash action */}
                  <div
                    className="shrink-0 px-2 flex items-center justify-center"
                    style={{ width: "36px" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!!thread?.id && (
                      <button
                        onClick={() => handleTrashThread(thread.id as string)}
                        title="Move to trash"
                        className="p-1 rounded transition-colors text-muted-foreground/25 hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply popup dialog */}
      <Dialog open={!!replyProspect} onOpenChange={(v) => !v && setReplyProspect(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span className="truncate">
                {replyProspect
                  ? `${(replyProspect.firstName as string) || ""} ${(replyProspect.lastName as string) || ""}`.trim() || (replyProspect.email as string)
                  : "Messages"}
              </span>
              {replyProspect?.email ? (
                <span className="text-xs font-normal text-muted-foreground truncate">
                  {String(replyProspect.email)}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {/* Prospect info bar — enrichment-aware. NOT_FOUND fields render
              "No data available" so the user can see what's been searched and
              missed without re-triggering enrichment. */}
          {replyProspect && (() => {
            const src = (replyProspect.enrichmentSource as EnrichmentSourceMap) ?? {};
            const detailRow = (label: string, value: unknown, fieldKey: EnrichFieldKey | null) => {
              const v = value && String(value).trim() ? String(value) : "";
              const source = fieldKey ? src[fieldKey] : undefined;
              if (v) {
                return (
                  <span key={label} className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground">{label}:</span>
                    <span className="text-foreground">{v}</span>
                    <SourceBadge source={source} />
                  </span>
                );
              }
              if (source === "NOT_FOUND") {
                return (
                  <span key={label} className="inline-flex items-center gap-1 italic text-muted-foreground/70">
                    <span>{label}:</span>
                    <Ban className="h-3 w-3" />
                    <span>No data available</span>
                  </span>
                );
              }
              return null;
            };
            const rows = [
              detailRow("Company", replyProspect.company, "company"),
              detailRow("Title", replyProspect.title, "title"),
              detailRow("Phone", replyProspect.phone, "phone"),
              detailRow("LinkedIn", replyProspect.linkedinUrl, "linkedinUrl"),
              replyProspect.campaignName
                ? <span key="campaign"><span className="text-muted-foreground">Campaign:</span> <span className="text-foreground">{String(replyProspect.campaignName)}</span></span>
                : null,
            ].filter(Boolean);
            if (rows.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs border-b border-border pb-3">
                {rows}
              </div>
            );
          })()}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0 py-2">
            {replyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : replyMessages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No messages found
              </div>
            ) : (
              replyMessages.map((msg) => {
                const isInbound = String(msg.direction) === "INBOUND";
                const body = String(msg.bodyText || msg.messageText || "");
                const subject = String(msg.subject || "");
                const from = String(msg.fromEmail || msg.linkedinFrom || "");
                const sentAt = String(msg.sentAt || msg.receivedAt || "");
                return (
                  <div
                    key={msg.id as string}
                    className={cn(
                      "rounded-lg border p-4",
                      isInbound
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/40 border-border"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            isInbound
                              ? "text-primary border-primary/30"
                              : "text-muted-foreground border-border"
                          )}
                        >
                          {isInbound ? "Reply" : "Sent"}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {from}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {sentAt ? formatFullDateTime(sentAt) : ""}
                      </span>
                    </div>
                    {subject && (
                      <p className="text-xs font-medium mb-1.5 text-foreground">{subject}</p>
                    )}
                    <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                      {body || <span className="text-muted-foreground italic">No content</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with View in Inbox button */}
          {replyProspect && !!(replyProspect.thread as Record<string, unknown>)?.id && (
            <div className="border-t border-border pt-3 flex justify-end">
              <button
                onClick={() => {
                  const threadId = (replyProspect.thread as Record<string, unknown>).id as string;
                  setReplyProspect(null);
                  openThread(threadId);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                <Mail className="h-3.5 w-3.5" />
                View in Inbox
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Enrich dialog — opens when user clicks the toolbar Enrich button.
          Receives the currently selected prospects so the modal can compute
          per-field "missing across selection" math client-side. */}
      <EnrichDialog
        open={enrichDialogOpen}
        onOpenChange={setEnrichDialogOpen}
        selected={prospects
          .filter((pp) => selectedIds.has((pp as { id: string }).id))
          .map((pp): EnrichDialogProspect => {
            const r = pp as Record<string, unknown>;
            return {
              id: r.id as string,
              email: r.email as string | null | undefined,
              linkedinUrl: r.linkedinUrl as string | null | undefined,
              phone: r.phone as string | null | undefined,
              title: r.title as string | null | undefined,
              company: r.company as string | null | undefined,
              domain: r.domain as string | null | undefined,
              enrichmentSource: r.enrichmentSource as EnrichDialogProspect["enrichmentSource"],
            };
          })}
        hasBlitz={hasBlitz}
        hasApollo={hasApollo}
        onCleared={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
