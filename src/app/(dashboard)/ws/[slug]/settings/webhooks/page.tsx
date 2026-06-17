"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLabels } from "@/hooks/use-labels";
import { Loader2, Plus, Trash2, ToggleLeft, ToggleRight, Send, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TriggerMode = "all" | "reply_received" | "lead_tagged";

const TRIGGER_LABELS: Record<TriggerMode, string> = {
  all: "All Events",
  reply_received: "Reply Received",
  lead_tagged: "Lead Tagged",
};

function triggersToMode(triggers: string[] | null): TriggerMode {
  const t = triggers ?? [];
  if (t.length === 0 || (t.includes("reply_received") && t.includes("lead_tagged"))) return "all";
  if (t.includes("reply_received")) return "reply_received";
  if (t.includes("lead_tagged")) return "lead_tagged";
  return "all";
}

function modeToTriggers(mode: TriggerMode): string[] {
  if (mode === "all") return ["reply_received", "lead_tagged"];
  return [mode];
}

type OutboundWebhook = {
  id: string;
  label: string;
  url: string;
  isActive: boolean;
  triggers: string[] | null;
  tagFilters: string[] | null;
  createdAt: string;
};

type WebhookLog = {
  id: string;
  createdAt: string;
  provider: string;
  eventType: string;
  status: string;
  errorMessage: string | null;
};

type DeliveryLog = {
  id: string;
  webhookUrl: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

const statusColor: Record<string, string> = {
  PROCESSED: "text-green-500 border-green-500",
  PENDING: "text-yellow-500 border-yellow-500",
  FAILED: "text-red-500 border-red-500",
  SKIPPED: "text-gray-500 border-gray-500",
};

export default function WebhooksPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"outbound" | "logs" | "delivery">("outbound");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTriggerMode, setNewTriggerMode] = useState<TriggerMode>("all");
  const [newTagFilters, setNewTagFilters] = useState<string[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: labels = [] } = useLabels();

  const { data: hooks = [], isLoading: hooksLoading } = useQuery<OutboundWebhook[]>({
    queryKey: ["outbound-webhooks", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/outbound-webhooks", {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<WebhookLog[]>({
    queryKey: ["webhook-logs", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/webhooks/logs", {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId && tab === "logs",
    refetchInterval: tab === "logs" ? 15000 : false,
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery<DeliveryLog[]>({
    queryKey: ["outbound-webhook-deliveries", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/outbound-webhooks/deliveries", {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId && tab === "delivery",
    refetchInterval: tab === "delivery" ? 15000 : false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outbound-webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId! },
        body: JSON.stringify({
          label: newLabel.trim(),
          url: newUrl.trim(),
          triggers: modeToTriggers(newTriggerMode),
          tagFilters: (newTriggerMode === "lead_tagged" || newTriggerMode === "all") ? newTagFilters : [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setDialogOpen(false);
      setNewLabel("");
      setNewUrl("");
      setNewTriggerMode("all");
      setNewTagFilters([]);
      queryClient.invalidateQueries({ queryKey: ["outbound-webhooks", workspaceId] });
      toast.success("Webhook added");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/outbound-webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId! },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["outbound-webhooks", workspaceId] }),
    onError: () => toast.error("Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/outbound-webhooks/${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outbound-webhooks", workspaceId] });
      toast.success("Webhook deleted");
    },
    onError: () => toast.error("Failed to delete"),
  });

  const handleTest = async (hook: OutboundWebhook) => {
    setTestingId(hook.id);
    try {
      const res = await fetch(`/api/outbound-webhooks/${hook.id}/test`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      toast.success("Test payload sent");
      // Refresh delivery logs if on that tab
      queryClient.invalidateQueries({ queryKey: ["outbound-webhook-deliveries", workspaceId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send test");
    } finally {
      setTestingId(null);
    }
  };

  const canAdd = newLabel.trim().length > 0 && newUrl.trim().length > 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Send lead events to external tools like Make, and view incoming webhook logs.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(["outbound", "logs", "delivery"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "outbound" ? "Outbound Webhooks" : t === "logs" ? "Incoming Logs" : "Delivery Logs"}
          </button>
        ))}
      </div>

      {tab === "outbound" && (
        <div className="space-y-6">
          {/* Add Webhook button */}
          <div className="flex justify-end">
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Webhook
            </button>
          </div>

          {/* Payload reference */}
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Payload shape</p>
            <pre className="text-xs text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap">{`{
  "event":        "reply_received" | "lead_tagged",
  "email":        "john@acme.com",
  "firstName":    "John",
  "lastName":     "Smith",
  "company":      "Acme Corp",
  "domain":       "acme.com",
  "phone":        "+1234567890",
  "title":        "Founder & CEO",
  "linkedinUrl":  "https://linkedin.com/in/johnsmith",
  "source":       "Email" | "LinkedIn",
  "campaignName": "Q2 Outbound",
  "stepReplied":  "Step 1",
  "label":        "Interested",
  "notes":        "Replied positively",
  "feedback":     null,
  "timestamp":    "2026-05-20T10:00:00.000Z"
}`}</pre>
          </div>

          {/* List */}
          {hooksLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hooks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No outbound webhooks yet. Click &ldquo;Add Webhook&rdquo; to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {hooks.map((hook) => (
                <div key={hook.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-start gap-3">
                  {/* Main info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{hook.label}</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {TRIGGER_LABELS[triggersToMode(hook.triggers)]}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground truncate">{hook.url}</p>
                    {(hook.tagFilters ?? []).length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Tags: {(hook.tagFilters ?? []).join(", ")}
                      </p>
                    )}
                  </div>

                  {/* Actions — always visible, never overflow */}
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {/* Toggle active */}
                    <button
                      onClick={() => toggleMutation.mutate({ id: hook.id, isActive: !hook.isActive })}
                      title={hook.isActive ? "Disable webhook" : "Enable webhook"}
                      className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-xs border border-border hover:bg-accent transition-colors"
                    >
                      {hook.isActive ? (
                        <><ToggleRight className="h-3.5 w-3.5 text-green-500" /><span className="text-green-600 dark:text-green-400">Active</span></>
                      ) : (
                        <><ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">Inactive</span></>
                      )}
                    </button>

                    {/* Test */}
                    <button
                      onClick={() => handleTest(hook)}
                      disabled={testingId === hook.id}
                      title="Send test payload"
                      className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {testingId === hook.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5" />}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => {
                        if (!confirm(`Delete webhook "${hook.label}"?`)) return;
                        deleteMutation.mutate(hook.id);
                      }}
                      title="Delete webhook"
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <>
          <p className="text-xs text-muted-foreground mb-4">Auto-refreshes every 15s</p>
          {logsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No webhook events received yet.
            </p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground w-36 shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="shrink-0">{log.provider}</Badge>
                  <span className="font-mono text-xs text-foreground shrink-0">{log.eventType}</span>
                  <Badge variant="outline" className={`shrink-0 ${statusColor[log.status]}`}>
                    {log.status}
                  </Badge>
                  {log.errorMessage && (
                    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                      {log.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "delivery" && (
        <>
          <p className="text-xs text-muted-foreground mb-4">
            Shows the last 100 outbound webhook delivery attempts. Auto-refreshes every 15s.
          </p>
          {deliveriesLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No outbound deliveries yet. Deliveries are logged when a webhook fires.
            </p>
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="rounded-lg border border-border bg-card px-4 py-3 flex items-start gap-3 flex-wrap"
                >
                  {/* Timestamp */}
                  <span className="text-xs text-muted-foreground w-36 shrink-0 pt-0.5">
                    {new Date(delivery.createdAt).toLocaleString()}
                  </span>

                  {/* Success / fail icon */}
                  <span className="shrink-0 pt-0.5">
                    {delivery.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </span>

                  {/* Status code badge */}
                  {delivery.statusCode != null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-xs font-mono",
                        delivery.success
                          ? "text-green-600 border-green-500 dark:text-green-400"
                          : "text-red-600 border-red-500 dark:text-red-400"
                      )}
                    >
                      {delivery.statusCode}
                    </Badge>
                  )}

                  {/* Event name */}
                  <span className="font-mono text-xs text-foreground shrink-0">{delivery.event}</span>

                  {/* URL */}
                  <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {delivery.webhookUrl}
                  </span>

                  {/* Error message (full row below if present) */}
                  {!delivery.success && delivery.errorMessage && (
                    <span className="w-full text-xs text-red-500 break-words pl-[calc(9rem+2rem+1rem)]">
                      {delivery.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Webhook Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) { setNewLabel(""); setNewUrl(""); setNewTriggerMode("all"); setNewTagFilters([]); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Webhook</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label</label>
              <Input
                placeholder="e.g. n8n CRM sync"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Webhook URL</label>
              <Input
                placeholder="https://..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="h-9 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">LeadBox will POST to this URL for the selected events.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Event type</label>
              <p className="text-xs text-muted-foreground">Select the event type you want to send notifications for</p>
              <Select value={newTriggerMode} onValueChange={(v) => { setNewTriggerMode(v as TriggerMode); setNewTagFilters([]); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="reply_received">Reply Received</SelectItem>
                  <SelectItem value="lead_tagged">Lead Tagged</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tag filter — shown when Lead Tagged (or All Events) is selected */}
            {(newTriggerMode === "lead_tagged" || newTriggerMode === "all") && (labels as { id: string; name: string }[]).length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Filter by tag <span className="text-muted-foreground font-normal">(optional — leave empty to fire for all tags)</span></label>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {(labels as { id: string; name: string; color: string }[]).map((l) => (
                    <label key={l.id} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={newTagFilters.includes(l.name)}
                        onChange={(e) =>
                          setNewTagFilters((prev) =>
                            e.target.checked ? [...prev, l.name] : prev.filter((n) => n !== l.name)
                          )
                        }
                        className="h-3.5 w-3.5 rounded accent-primary shrink-0"
                      />
                      <span className="text-xs truncate">{l.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setDialogOpen(false)}
                className="px-4 h-9 rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!canAdd || createMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors",
                  canAdd
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add Webhook
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
