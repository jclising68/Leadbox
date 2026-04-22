"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Plus, Check, Loader2, Plug, Trash2, RefreshCw, Database, AlertTriangle, Power } from "lucide-react";

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

export default function IntegrationsPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("INSTANTLY");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/integrations", {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      return res.json();
    },
    enabled: !!workspaceId,
    // Poll faster when any integration is actively syncing so the progress
    // bar feels live; otherwise the page is mostly static.
    refetchInterval: (q) => {
      const list = (q.state.data as { syncing?: boolean }[] | undefined) ?? [];
      return list.some((i) => i.syncing) ? 2000 : 15000;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: headers(workspaceId!),
        body: JSON.stringify({ provider, name, apiKey }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setOpen(false);
      setName("");
      setApiKey("");
      toast.success("Integration added! Syncing previous conversations in the background...");
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/integrations/${id}/test`, {
        method: "POST",
        headers: headers(workspaceId!),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => toast.success("Connection successful!"),
    onError: (err) => toast.error(`Connection failed: ${err.message}`),
  });

  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      setSyncingIds((prev) => new Set(prev).add(id));
      const res = await fetch(`/api/integrations/${id}/sync`, {
        method: "POST",
        headers: headers(workspaceId!),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return { ...data, _id: id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      if (data.status === "already_running") {
        toast.info("Sync is already in progress...");
      } else {
        toast.success("Sync started! This may take several minutes.");
      }
    },
    onError: (err) => toast.error(`Sync failed: ${err.message}`),
    onSettled: (_d, _e, id) => {
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        headers: headers(workspaceId!),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "DELETE",
        headers: headers(workspaceId!),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integration removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const enrichMutation = useMutation({
    mutationFn: async (id: string) => {
      setEnrichingIds((prev) => new Set(prev).add(id));
      const res = await fetch(`/api/integrations/${id}/enrich`, {
        method: "POST",
        headers: headers(workspaceId!),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data.status === "already_running") {
        toast.info("Enrichment already in progress...");
      } else {
        toast.success("Enrichment started! Lead details (company, title, status) will be fetched in background.");
      }
    },
    onError: (err) => toast.error(`Enrich failed: ${err.message}`),
    onSettled: (_d, _e, id) => {
      setEnrichingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    },
  });

  function copyWebhookUrl(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    toast.success("Webhook URL copied to clipboard");
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect your outreach tools to receive messages
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Add Integration
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Integration</DialogTitle>
              <DialogDescription>
                Connect Instantly or HeyReach to receive messages
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INSTANTLY">Instantly.ai</SelectItem>
                    <SelectItem value="HEYREACH">HeyReach</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Main Account"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Your API key"
                />
              </div>
              <Button
                className="w-full"
                onClick={() => createMutation.mutate()}
                disabled={!name || !apiKey || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Add Integration
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : integrations?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Plug className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No integrations connected yet
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {integrations?.map(
            (int: {
              id: string;
              provider: string;
              name: string;
              isActive: boolean;
              apiKeyMasked: string;
              webhookUrl: string;
              lastSyncAt: string | null;
              lastActivityAt: string | null;
              totalMessages: number;
              messagesLast30Days?: number;
              syncing: boolean;
              syncStuck?: boolean;
              enriching: boolean;
              createdAt: string;
              lastError?: string | null;
              lastErrorAt?: string | null;
              syncProgress?: {
                stage: string;
                message: string;
                percent: number;
                current?: number;
                total?: number;
                updatedAt: string;
              } | null;
              backfillCutoffDate?: string | null;
              backfillComplete?: boolean;
              oldestReached?: string | null;
            }) => (
              <Card key={int.id} className={!int.isActive ? "opacity-70" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{int.name}</CardTitle>
                      <Badge variant={int.isActive ? "default" : "secondary"}>
                        {int.provider}
                      </Badge>
                      {!int.isActive && (
                        <Badge variant="destructive">Inactive — not syncing</Badge>
                      )}
                      {int.syncStuck && (
                        <Badge variant="destructive">Stuck sync</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => patchMutation.mutate({ id: int.id, body: { isActive: !int.isActive } })}
                        disabled={patchMutation.isPending}
                        title={int.isActive ? "Disable sync for this integration" : "Re-enable sync"}
                      >
                        <Power className="h-3 w-3 mr-1" />
                        {int.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncMutation.mutate(int.id)}
                        disabled={syncingIds.has(int.id) || (int.syncing && !int.syncStuck) || !int.isActive}
                      >
                        {syncingIds.has(int.id) || (int.syncing && !int.syncStuck) ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        Sync
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => enrichMutation.mutate(int.id)}
                        disabled={
                          enrichingIds.has(int.id) ||
                          int.enriching ||
                          (int.syncing && !int.syncStuck) ||
                          syncingIds.has(int.id) ||
                          !int.isActive
                        }
                        title={
                          int.syncing && !int.syncStuck
                            ? "Enrichment will be available once sync finishes"
                            : undefined
                        }
                      >
                        {enrichingIds.has(int.id) || int.enriching ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Database className="h-3 w-3 mr-1" />
                        )}
                        Enrich
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate(int.id)}
                        disabled={testMutation.isPending}
                      >
                        {testMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Test"
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Remove ${int.name}? Historical messages are kept.`)) {
                            deleteMutation.mutate(int.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        title="Remove integration"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    API Key: {int.apiKeyMasked}
                    {int.totalMessages > 0 && (
                      <> &middot; {int.totalMessages.toLocaleString()} messages</>
                    )}
                    {typeof int.messagesLast30Days === "number" && (
                      <> &middot; {int.messagesLast30Days.toLocaleString()} last 30 days</>
                    )}
                    {int.lastSyncAt && (
                      <> &middot; Last sync: {new Date(int.lastSyncAt).toLocaleString()}</>
                    )}
                    {int.lastActivityAt && (
                      <> &middot; Last activity: {new Date(int.lastActivityAt).toLocaleString()}</>
                    )}
                  </CardDescription>
                  {int.lastError && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">Last sync failed</div>
                        <div className="truncate" title={int.lastError}>{int.lastError}</div>
                      </div>
                      <button
                        onClick={() => patchMutation.mutate({ id: int.id, body: { clearError: true } })}
                        className="text-[10px] underline shrink-0 hover:opacity-80"
                      >
                        dismiss
                      </button>
                    </div>
                  )}
                  {int.syncStuck && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <span>Sync lock is older than 6 min — likely killed mid-run.</span>
                      <button
                        onClick={async () => {
                          await patchMutation.mutateAsync({ id: int.id, body: { clearSyncLock: true } });
                          syncMutation.mutate(int.id);
                        }}
                        className="text-[11px] underline shrink-0 hover:opacity-80"
                      >
                        unstick &amp; retry
                      </button>
                    </div>
                  )}
                  {int.syncing && int.syncProgress && (() => {
                    // Honest progress: only render a % bar when the current
                    // stage reports a real denominator (processing phase,
                    // which knows how many new emails are queued). Fetching
                    // pages has no known total — show counts + last-update
                    // timestamp instead of inventing a number.
                    const p = int.syncProgress;
                    const hasRealTotal =
                      typeof p.total === "number" &&
                      p.total > 0 &&
                      typeof p.current === "number" &&
                      p.stage === "processing";
                    const realPct = hasRealTotal
                      ? Math.min(100, Math.floor((p.current! / p.total!) * 100))
                      : null;
                    return (
                      <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
                        <div className="flex items-center justify-between text-xs text-foreground mb-1">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            <span className="truncate">{p.message}</span>
                          </span>
                          {realPct !== null && (
                            <span className="tabular-nums text-muted-foreground shrink-0 ml-2">
                              {realPct}%
                            </span>
                          )}
                        </div>
                        {realPct !== null ? (
                          <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${realPct}%` }}
                            />
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground">
                            Updated {new Date(p.updatedAt).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {!int.syncing && int.provider === "INSTANTLY" && int.backfillCutoffDate && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <span className="truncate">
                        {int.backfillComplete ? "Backfilled" : "Backfilling"} back to{" "}
                        <span className="font-medium text-foreground">
                          {new Date(int.backfillCutoffDate).toISOString().slice(0, 10)}
                        </span>
                        {int.oldestReached && (
                          <> · reached {new Date(int.oldestReached).toISOString().slice(0, 10)}</>
                        )}
                      </span>
                      {int.backfillComplete &&
                        new Date(int.backfillCutoffDate) >= new Date("2026-01-01T00:00:00.000Z") && (
                          <button
                            onClick={async () => {
                              await patchMutation.mutateAsync({
                                id: int.id,
                                body: { expandBackfillTo: "2025-01-01T00:00:00.000Z" },
                              });
                              syncMutation.mutate(int.id);
                            }}
                            disabled={patchMutation.isPending}
                            className="shrink-0 text-[11px] underline hover:opacity-80"
                          >
                            Expand to 2025
                          </button>
                        )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Webhook URL (paste this in {int.provider.toLowerCase() === "instantly" ? "Instantly" : "HeyReach"})
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={int.webhookUrl}
                        className="text-xs font-mono"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyWebhookUrl(int.webhookUrl, int.id)}
                      >
                        {copied === int.id ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
