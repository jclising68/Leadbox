"use client";

import { useState, useRef, useId, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  ChevronDown,
  GripVertical,
  DollarSign,
  User,
  Building,
  ExternalLink,
  X,
  Check,
  Tag,
  Clock,
  Send,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter, useParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineStage = { id: string; name: string; color: string; sortOrder: number };
type StageFormItem = { id?: string; name: string; color: string };

type Pipeline = {
  id: string;
  name: string;
  stages: PipelineStage[];
  _count: { deals: number };
};

type Deal = {
  id: string;
  pipelineId: string;
  stageId: string;
  title: string;
  notes: string | null;
  value: number | null;
  prospectId: string | null;
  threadId: string | null;
  prospect: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    company: string | null;
    title: string | null;
  } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#3B82F6", "#22C55E", "#EF4444", "#A855F7", "#F97316",
  "#6B7280", "#EAB308", "#EC4899", "#14B8A6", "#F59E0B",
];

const DEFAULT_STAGES = [
  { name: "New Lead", color: "#3B82F6" },
  { name: "Contacted", color: "#A855F7" },
  { name: "Proposal Sent", color: "#F97316" },
  { name: "Closed", color: "#22C55E" },
];

function hdrs(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

function formatValue(v: number | null) {
  if (v == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function prospectName(p: Deal["prospect"]) {
  if (!p) return null;
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || null;
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

type ActivityEvent = {
  id: string;
  type:
    | "label_applied"
    | "label_removed"
    | "follow_up_scheduled"
    | "follow_up_cleared"
    | "reply_sent"
    | "pipeline_added"
    | "pipeline_moved"
    | "pipeline_removed";
  metadata: Record<string, string | null>;
  createdAt: string;
};

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ActivityFeed({ activities, loading }: { activities: ActivityEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No activity yet for this lead.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {activities.map((event) => {
        let Icon: React.ElementType = Tag;
        let dotColor = "bg-muted-foreground";
        let description = "";

        switch (event.type) {
          case "label_applied":
            Icon = Tag;
            dotColor = "bg-green-500";
            description = `Tagged: ${event.metadata.label ?? ""}`;
            break;
          case "label_removed":
            Icon = Tag;
            dotColor = "bg-muted-foreground";
            description = `Label removed: ${event.metadata.label ?? ""}`;
            break;
          case "follow_up_scheduled": {
            Icon = Clock;
            dotColor = "bg-amber-500";
            const d = event.metadata.date
              ? new Date(event.metadata.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "";
            description = `Follow-up scheduled${d ? ` for ${d}` : ""}`;
            break;
          }
          case "follow_up_cleared":
            Icon = Clock;
            dotColor = "bg-muted-foreground";
            description = "Follow-up cleared";
            break;
          case "reply_sent":
            Icon = Send;
            dotColor = "bg-blue-500";
            description = "You replied";
            break;
          case "pipeline_added":
            Icon = GitBranch;
            dotColor = "bg-purple-500";
            description = `Added to ${event.metadata.pipeline ?? ""} → ${event.metadata.stage ?? ""}`;
            break;
          case "pipeline_moved":
            Icon = ArrowRight;
            dotColor = "bg-purple-500";
            description = `Moved: ${event.metadata.fromStage ?? ""} → ${event.metadata.toStage ?? ""} in ${event.metadata.pipeline ?? ""}`;
            break;
          case "pipeline_removed":
            Icon = X;
            dotColor = "bg-muted-foreground";
            description = `Removed from ${event.metadata.pipeline ?? ""}`;
            break;
        }

        return (
          <div key={event.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="relative shrink-0">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={cn("absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full", dotColor)} />
            </div>
            <p className="text-xs text-foreground flex-1 leading-snug">{description}</p>
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
              {formatRelative(event.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage row inside Create Pipeline dialog ──────────────────────────────────

function StageRow({
  stage,
  onChange,
  onDelete,
  canDelete,
}: {
  stage: { name: string; color: string };
  onChange: (s: { name: string; color: string }) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [colorOpen, setColorOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        <Input
          value={stage.name}
          onChange={(e) => onChange({ ...stage, name: e.target.value })}
          placeholder="Stage name"
          className="flex-1 h-8 text-sm"
        />
        <button
          type="button"
          onClick={() => setColorOpen((p) => !p)}
          className="w-6 h-6 rounded-full ring-2 ring-offset-1 ring-border hover:ring-foreground/40 transition-all shrink-0"
          style={{ backgroundColor: stage.color }}
          title="Pick color"
        />
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete}
          className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors shrink-0"
          title="Remove stage"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline color picker — no absolute positioning, so no dialog overflow */}
      {colorOpen && (
        <div className="flex items-center gap-1.5 pl-6 pb-1 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange({ ...stage, color: c }); setColorOpen(false); }}
              className={cn(
                "w-5 h-5 rounded-full ring-2 ring-offset-1 transition-all",
                stage.color === c ? "ring-foreground" : "ring-transparent hover:ring-border"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          {/* "+" opens native full color picker */}
          <label className="relative w-5 h-5 shrink-0 cursor-pointer" title="Custom color">
            <span className="absolute inset-0 rounded-full border-2 border-border hover:border-foreground/60 flex items-center justify-center transition-colors bg-background">
              <Plus className="h-3 w-3 text-muted-foreground" />
            </span>
            <input
              type="color"
              value={stage.color}
              onChange={(e) => { onChange({ ...stage, color: e.target.value }); }}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ─── Create / Edit Pipeline Dialog (GHL-style) ────────────────────────────────

function PipelineFormDialog({
  open,
  onClose,
  onSave,
  initial,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, stages: StageFormItem[]) => void;
  initial?: Pipeline | null;
  isPending: boolean;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [stages, setStages] = useState<StageFormItem[]>(DEFAULT_STAGES);

  // Sync on open
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(initial?.name ?? "");
      setStages(
        initial?.stages.length
          ? initial.stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))
          : DEFAULT_STAGES
      );
    }
  }

  function addStage() {
    setStages((p) => [...p, { name: "", color: PRESET_COLORS[p.length % PRESET_COLORS.length] }]);
  }

  function updateStage(i: number, s: StageFormItem) {
    setStages((p) => p.map((x, j) => j === i ? s : x));
  }

  function removeStage(i: number) {
    setStages((p) => p.filter((_, j) => j !== i));
  }

  const validStages = stages.filter((s) => s.name.trim());
  const canSave = name.trim() && validStages.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit pipeline" : "Create Pipeline"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Pipeline name */}
          <div>
            <Label htmlFor={`${uid}-name`} className="text-sm font-medium mb-1.5 block">
              Pipeline name *
            </Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LA Sales Pipeline"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use a unique, descriptive name so you can find this pipeline later
            </p>
          </div>

          {/* Stages */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">
                Pipeline stages ({stages.length})
              </Label>
              <button
                type="button"
                onClick={addStage}
                className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Add stage
              </button>
            </div>

            <div className="space-y-2">
              {stages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                  Add at least one stage
                </p>
              ) : (
                stages.map((stage, i) => (
                  <StageRow
                    key={i}
                    stage={stage}
                    onChange={(s) => updateStage(i, s)}
                    onDelete={() => removeStage(i)}
                    canDelete={stages.length > 1}
                  />
                ))
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1 border-t border-border">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              className="flex-1"
              disabled={!canSave || isPending}
              onClick={() => onSave(name.trim(), validStages)}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (initial ? "Save" : "Create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onEdit,
  onDelete,
  onDragStart,
  slug,
}: {
  deal: Deal;
  onEdit: (d: Deal) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  slug: string;
}) {
  const router = useRouter();
  const name = prospectName(deal.prospect);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal.id)}
      className="group bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <p className="text-sm font-medium leading-snug flex-1 truncate">{deal.title}</p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onEdit(deal)} className="p-0.5 rounded text-muted-foreground hover:text-foreground" title="Edit">
            <Pencil className="h-3 w-3" />
          </button>
          {deal.threadId && (
            <button
              onClick={() => router.push(`/ws/${slug}/inbox?thread=${deal.threadId}`)}
              className="p-0.5 rounded text-muted-foreground hover:text-primary"
              title="Open thread"
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          <button onClick={() => onDelete(deal.id)} className="p-0.5 rounded text-muted-foreground hover:text-destructive" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {name && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">{name}</span>
        </div>
      )}
      {deal.prospect?.company && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Building className="h-3 w-3 shrink-0" />
          <span className="truncate">{deal.prospect.company}</span>
        </div>
      )}
      {deal.value != null && (
        <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1.5">
          <DollarSign className="h-3 w-3 shrink-0" />
          {formatValue(deal.value)}
        </div>
      )}
      {deal.notes && (
        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{deal.notes}</p>
      )}
    </div>
  );
}

// ─── Deal Form Dialog ─────────────────────────────────────────────────────────

function DealDialog({
  open,
  onClose,
  onSave,
  stages,
  initial,
  defaultStageId,
  isPending,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (d: { title: string; stageId: string; notes: string; value: string }) => void;
  stages: PipelineStage[];
  initial?: Deal | null;
  defaultStageId?: string;
  isPending: boolean;
  workspaceId: string | null | undefined;
}) {
  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState("");
  const [notes, setNotes] = useState("");
  const [value, setValue] = useState("");
  const [loadedActivity, setLoadedActivity] = useState<{ key: string; data: ActivityEvent[] } | null>(null);

  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTitle(initial?.title ?? "");
      setStageId(initial?.stageId ?? defaultStageId ?? stages[0]?.id ?? "");
      setNotes(initial?.notes ?? "");
      setValue(initial?.value != null ? String(initial.value) : "");
    }
  }

  // Fetch activity when dialog opens and deal has a threadId
  // Loading/data are derived from which key has finished loading, so the effect only sets state in the async callback.
  const activityKey = open && initial?.threadId && workspaceId ? `${workspaceId}:${initial.threadId}` : null;
  const activitiesLoading = activityKey !== null && loadedActivity?.key !== activityKey;
  const activities = activityKey !== null && loadedActivity?.key === activityKey ? loadedActivity.data : [];

  useEffect(() => {
    if (!open || !initial?.threadId || !workspaceId) return;
    let cancelled = false;
    const key = `${workspaceId}:${initial.threadId}`;
    fetch(`/api/threads/${initial.threadId}/activity`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((res) => (res.ok ? (res.json() as Promise<ActivityEvent[]>) : Promise.resolve([])))
      .catch(() => [])
      .then((data) => {
        if (!cancelled) {
          setLoadedActivity({ key, data });
        }
      });
    return () => { cancelled = true; };
  }, [open, initial?.threadId, workspaceId]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit deal" : "New deal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-xs mb-1.5 block">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deal title" autoFocus />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Stage</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Value (USD)</Label>
            <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Notes</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
            />
          </div>

          {/* Activity section — only shown when deal is linked to a thread */}
          {initial?.threadId && (
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-xs font-semibold text-foreground mb-3">Activity</p>
              <ActivityFeed activities={activities} loading={activitiesLoading} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              className="flex-1"
              disabled={!title.trim() || !stageId || isPending}
              onClick={() => onSave({ title: title.trim(), stageId, notes, value })}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  deals,
  slug,
  onAddDeal,
  onEditDeal,
  onDeleteDeal,
  onDragStart,
  onDrop,
}: {
  stage: PipelineStage;
  deals: Deal[];
  slug: string;
  onAddDeal: () => void;
  onEditDeal: (d: Deal) => void;
  onDeleteDeal: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrop: (stageId: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const stageValue = deals.reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div className="flex flex-col w-[280px] shrink-0">
      {/* Column header */}
      <div className="mb-2 px-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold truncate flex-1">{stage.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{deals.length}</span>
        </div>
        <p className="text-xs text-muted-foreground pl-4">
          {deals.length} Opportunities · {formatValue(stageValue) ?? "$0"}
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          "flex-1 flex flex-col gap-2 min-h-[300px] rounded-xl p-2 transition-colors",
          isDragOver ? "bg-primary/5 ring-2 ring-primary/30" : "bg-muted/25"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={() => { setIsDragOver(false); onDrop(stage.id); }}
      >
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            slug={slug}
            onEdit={onEditDeal}
            onDelete={onDeleteDeal}
            onDragStart={onDragStart}
          />
        ))}

        <button
          onClick={onAddDeal}
          className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors w-full mt-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          Add opportunity
        </button>
      </div>
    </div>
  );
}

// ─── Pipeline Switcher Dropdown ───────────────────────────────────────────────

function PipelineSwitcher({
  pipelines,
  activePipelineId,
  onSelect,
  onNew,
}: {
  pipelines: Pipeline[];
  activePipelineId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = pipelines.find((p) => p.id === activePipelineId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm font-medium min-w-[200px]"
      >
        <span className="flex-1 text-left truncate">{active?.name ?? "Select pipeline"}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 left-0 top-full mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg py-1 overflow-hidden">
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
              >
                <span className="truncate flex-1">{p.name}</span>
                {p.id === activePipelineId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => { onNew(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New pipeline
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Pipeline Page ────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const workspaceId = useCurrentWorkspaceId();
  const params = useParams();
  const slug = params.slug as string;
  const queryClient = useQueryClient();

  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [pipelineFormOpen, setPipelineFormOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string | undefined>();
  const draggingDealId = useRef<string | null>(null);

  // ── Pipelines query ─────────────────────────────────────────────────────

  const { data: pipelines = [], isLoading: pipelinesLoading, isFetching: pipelinesFetching } = useQuery<Pipeline[]>({
    queryKey: ["pipelines", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/pipeline", { headers: { "x-workspace-id": workspaceId! } });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as Pipeline[];
      // Auto-select first pipeline
      if (data.length > 0 && !activePipelineId) {
        setActivePipelineId(data[0].id);
      }
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 10000,
  });

  // ── Deals query (for active pipeline) ──────────────────────────────────

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["pipeline-deals", workspaceId, activePipelineId],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline/deals?pipelineId=${activePipelineId}`, {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!workspaceId && !!activePipelineId,
    staleTime: 10000,
  });

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? null;

  // ── Pipeline mutations ──────────────────────────────────────────────────

  const createPipeline = useMutation({
    mutationFn: async ({ name, stages }: { name: string; stages: Array<{ name: string; color: string }> }) => {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: hdrs(workspaceId!),
        body: JSON.stringify({ name, stages }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      return j as Pipeline;
    },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
      setActivePipelineId(p.id);
      setPipelineFormOpen(false);
      setEditingPipeline(null);
      toast.success("Pipeline created");
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePipelineWithStages = useMutation({
    mutationFn: async ({
      id,
      name,
      formStages,
      existingStages,
    }: {
      id: string;
      name: string;
      formStages: StageFormItem[];
      existingStages: PipelineStage[];
    }) => {
      const ops: Promise<Response>[] = [];

      // Rename if changed
      const current = pipelines.find((p) => p.id === id);
      if (!current || current.name !== name.trim()) {
        ops.push(fetch(`/api/pipeline/${id}`, {
          method: "PATCH",
          headers: hdrs(workspaceId!),
          body: JSON.stringify({ name }),
        }));
      }

      // PATCH existing stages that changed name or color
      for (const fs of formStages) {
        if (!fs.id) continue;
        const orig = existingStages.find((s) => s.id === fs.id);
        if (orig && (orig.name !== fs.name.trim() || orig.color !== fs.color)) {
          ops.push(fetch(`/api/pipeline/stages/${fs.id}`, {
            method: "PATCH",
            headers: hdrs(workspaceId!),
            body: JSON.stringify({ name: fs.name.trim(), color: fs.color }),
          }));
        }
      }

      // POST brand-new stages (no id)
      for (const fs of formStages) {
        if (fs.id || !fs.name.trim()) continue;
        ops.push(fetch("/api/pipeline/stages", {
          method: "POST",
          headers: hdrs(workspaceId!),
          body: JSON.stringify({ pipelineId: id, name: fs.name.trim(), color: fs.color }),
        }));
      }

      // DELETE stages removed from the form
      const keptIds = new Set(formStages.filter((s) => s.id).map((s) => s.id));
      for (const orig of existingStages) {
        if (!keptIds.has(orig.id)) {
          ops.push(fetch(`/api/pipeline/stages/${orig.id}`, {
            method: "DELETE",
            headers: hdrs(workspaceId!),
          }));
        }
      }

      const results = await Promise.all(ops);
      for (const res of results) {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(body.error ?? "Failed to update pipeline");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals", workspaceId, activePipelineId] });
      setPipelineFormOpen(false);
      setEditingPipeline(null);
      toast.success("Pipeline updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePipeline = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pipeline/${id}`, {
        method: "DELETE",
        headers: hdrs(workspaceId!),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
      setActivePipelineId(null);
      toast.success("Pipeline deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Deal mutations ──────────────────────────────────────────────────────

  const createDeal = useMutation({
    mutationFn: async (d: { title: string; stageId: string; notes: string; value: string }) => {
      const res = await fetch("/api/pipeline/deals", {
        method: "POST",
        headers: hdrs(workspaceId!),
        body: JSON.stringify({
          pipelineId: activePipelineId,
          stageId: d.stageId,
          title: d.title,
          notes: d.notes || null,
          value: d.value ? parseFloat(d.value) : null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals", workspaceId, activePipelineId] });
      setDealDialogOpen(false);
      setEditingDeal(null);
      toast.success("Deal added");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateDeal = useMutation({
    mutationFn: async ({ id, ...d }: { id: string; title: string; stageId: string; notes: string; value: string }) => {
      const res = await fetch(`/api/pipeline/deals/${id}`, {
        method: "PATCH",
        headers: hdrs(workspaceId!),
        body: JSON.stringify({
          title: d.title,
          stageId: d.stageId,
          notes: d.notes || null,
          value: d.value ? parseFloat(d.value) : null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals", workspaceId, activePipelineId] });
      setDealDialogOpen(false);
      setEditingDeal(null);
      toast.success("Deal updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pipeline/deals/${id}`, { method: "DELETE", headers: hdrs(workspaceId!) });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals", workspaceId, activePipelineId] });
      toast.success("Deal deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const moveDeal = useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const res = await fetch(`/api/pipeline/deals/${dealId}`, {
        method: "PATCH",
        headers: hdrs(workspaceId!),
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals", workspaceId, activePipelineId] });
      toast.error(e.message);
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleDrop(targetStageId: string) {
    const dealId = draggingDealId.current;
    if (!dealId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === targetStageId) return;
    queryClient.setQueryData<Deal[]>(["pipeline-deals", workspaceId, activePipelineId], (prev) =>
      prev?.map((d) => d.id === dealId ? { ...d, stageId: targetStageId } : d) ?? []
    );
    moveDeal.mutate({ dealId, stageId: targetStageId });
    draggingDealId.current = null;
  }

  function handleSavePipeline(name: string, stages: StageFormItem[]) {
    if (editingPipeline) {
      updatePipelineWithStages.mutate({
        id: editingPipeline.id,
        name,
        formStages: stages,
        existingStages: editingPipeline.stages,
      });
    } else {
      createPipeline.mutate({ name, stages });
    }
  }

  function handleSaveDeal(d: { title: string; stageId: string; notes: string; value: string }) {
    if (editingDeal) {
      updateDeal.mutate({ id: editingDeal.id, ...d });
    } else {
      createDeal.mutate(d);
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────

  const totalValue = deals.reduce((s, d) => s + (d.value ?? 0), 0);
  const dealsPerStage = (activePipeline?.stages ?? []).reduce<Record<string, Deal[]>>((acc, s) => {
    acc[s.id] = deals.filter((d) => d.stageId === s.id);
    return acc;
  }, {});

  if (pipelinesLoading && pipelinesFetching) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card/40 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          {/* Pipeline switcher */}
          {pipelines.length > 0 ? (
            <PipelineSwitcher
              pipelines={pipelines}
              activePipelineId={activePipelineId}
              onSelect={setActivePipelineId}
              onNew={() => { setEditingPipeline(null); setPipelineFormOpen(true); }}
            />
          ) : null}

          {activePipeline && (
            <span className="text-sm text-muted-foreground">
              {deals.length} opportunit{deals.length !== 1 ? "ies" : "y"}
              {totalValue > 0 && (
                <> · {formatValue(totalValue)}</>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activePipeline && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                onClick={() => { setEditingPipeline(activePipeline); setPipelineFormOpen(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit pipeline
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (!confirm(`Delete pipeline "${activePipeline.name}"? All deals will be lost.`)) return;
                  deletePipeline.mutate(activePipeline.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setEditingDeal(null);
                  setDefaultStageId(activePipeline.stages[0]?.id);
                  setDealDialogOpen(true);
                }}
                disabled={activePipeline.stages.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                Add opportunity
              </Button>
            </>
          )}

          {pipelines.length === 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => { setEditingPipeline(null); setPipelineFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Create pipeline
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {pipelines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <div className="text-5xl mb-4">🗂️</div>
          <p className="text-sm font-medium text-foreground/80 mb-1">No pipelines yet</p>
          <p className="text-xs mb-5 text-center max-w-xs">
            Create your first named pipeline and define its stages to start tracking opportunities
          </p>
          <Button size="sm" onClick={() => { setEditingPipeline(null); setPipelineFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create pipeline
          </Button>
        </div>
      ) : !activePipeline ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Select a pipeline from the dropdown
        </div>
      ) : dealsLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 h-full px-6 py-5 min-w-max">
            {activePipeline.stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                deals={dealsPerStage[stage.id] ?? []}
                slug={slug}
                onAddDeal={() => {
                  setEditingDeal(null);
                  setDefaultStageId(stage.id);
                  setDealDialogOpen(true);
                }}
                onEditDeal={(d) => { setEditingDeal(d); setDealDialogOpen(true); }}
                onDeleteDeal={(id) => {
                  if (!confirm("Delete this deal?")) return;
                  deleteDeal.mutate(id);
                }}
                onDragStart={(id) => { draggingDealId.current = id; }}
                onDrop={handleDrop}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create / Edit Pipeline dialog */}
      <PipelineFormDialog
        open={pipelineFormOpen}
        onClose={() => { setPipelineFormOpen(false); setEditingPipeline(null); }}
        onSave={handleSavePipeline}
        initial={editingPipeline}
        isPending={createPipeline.isPending || updatePipelineWithStages.isPending}
      />

      {/* Deal dialog */}
      {activePipeline && (
        <DealDialog
          open={dealDialogOpen}
          onClose={() => { setDealDialogOpen(false); setEditingDeal(null); }}
          onSave={handleSaveDeal}
          stages={activePipeline.stages}
          initial={editingDeal}
          defaultStageId={defaultStageId}
          isPending={createDeal.isPending || updateDeal.isPending}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
