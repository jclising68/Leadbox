"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Trash2, ToggleLeft, ToggleRight, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type OutboundWebhook = {
  id: string;
  label: string;
  url: string;
  isActive: boolean;
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

const statusColor: Record<string, string> = {
  PROCESSED: "text-green-500 border-green-500",
  PENDING: "text-yellow-500 border-yellow-500",
  FAILED: "text-red-500 border-red-500",
  SKIPPED: "text-gray-500 border-gray-500",
};

export default function WebhooksPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"outbound" | "logs">("outbound");
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

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

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outbound-webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId! },
        body: JSON.stringify({ label: newLabel.trim(), url: newUrl.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setNewLabel("");
      setNewUrl("");
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
      await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "test",
          email: "test@example.com",
          firstName: "Test",
          lastName: "Lead",
          company: "Acme Corp",
          domain: "acme.com",
          campaignName: "Test Campaign",
          label: "Interested",
          timestamp: new Date().toISOString(),
        }),
      });
      toast.success("Test payload sent");
    } catch {
      toast.error("Failed to send test");
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
        {(["outbound", "logs"] as const).map((t) => (
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
            {t === "outbound" ? "Outbound Webhooks" : "Incoming Logs"}
          </button>
        ))}
      </div>

      {tab === "outbound" && (
        <div className="space-y-6">
          {/* Add form */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-medium">Add webhook</p>
            <div className="flex gap-2">
              <Input
                placeholder="Label (e.g. Google Sheets)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-44 h-9 text-sm"
              />
              <Input
                placeholder="https://hook.make.com/..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="flex-1 h-9 text-sm font-mono"
              />
              <button
                onClick={() => createMutation.mutate()}
                disabled={!canAdd || createMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium transition-colors shrink-0",
                  canAdd
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              LeadBox will POST to this URL whenever a lead replies or gets tagged. Works with Make, n8n, Zapier, or any webhook receiver.
            </p>
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
  "campaignName": "Q2 Outbound",
  "label":        "Interested",
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
              No outbound webhooks yet. Add one above to start forwarding lead events.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {hooks.map((hook) => (
                  <TableRow key={hook.id}>
                    <TableCell className="font-medium text-sm">{hook.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">
                      {hook.url}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleMutation.mutate({ id: hook.id, isActive: !hook.isActive })}
                        className="inline-flex items-center gap-1.5 text-xs"
                      >
                        {hook.isActive ? (
                          <><ToggleRight className="h-4 w-4 text-green-500" /><span className="text-green-600 dark:text-green-400">Active</span></>
                        ) : (
                          <><ToggleLeft className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Inactive</span></>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleTest(hook)}
                          disabled={testingId === hook.id}
                          title="Send test payload"
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {testingId === hook.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(hook.id)}
                          title="Delete webhook"
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.provider}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.eventType}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor[log.status]}>
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {log.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
