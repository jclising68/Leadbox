"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Copy, Check, Loader2, Plug, Trash2, RefreshCw, Database, AlertTriangle, Power } from "lucide-react";
import Image from "next/image";

type ProviderId = "INSTANTLY" | "HEYREACH" | "LEMLIST" | "BLITZ" | "APOLLO" | "SLACK";

const PROVIDERS: {
  id: ProviderId;
  name: string;
  kind: "Inbound sync" | "Enrichment" | "Notifications";
  description: string;
  logo: string;
}[] = [
  {
    id: "INSTANTLY",
    name: "Instantly.ai",
    kind: "Inbound sync",
    description: "Sync email replies and conversations from Instantly.",
    logo: "/branding/instantly.png",
  },
  {
    id: "HEYREACH",
    name: "HeyReach",
    kind: "Inbound sync",
    description: "Sync LinkedIn replies and DMs from HeyReach.",
    logo: "/branding/heyreach.png",
  },
  {
    id: "LEMLIST",
    name: "Lemlist",
    kind: "Inbound sync",
    description: "Sync email replies from Lemlist campaigns.",
    logo: "/branding/lemlist.svg",
  },
  {
    id: "BLITZ",
    name: "Blitz",
    kind: "Enrichment",
    description: "Primary — verified emails + US mobile phones.",
    logo: "/branding/blitz.jpeg",
  },
  {
    id: "APOLLO",
    name: "Apollo",
    kind: "Enrichment",
    description: "Fallback — global phones + richer firmographics.",
    logo: "/branding/apollo.png",
  },
  {
    id: "SLACK",
    name: "Slack",
    kind: "Notifications",
    description: "Send follow-up reminders to a Slack channel via Incoming Webhook.",
    logo: "/branding/slack.svg",
  },
];

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

export default function IntegrationsPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const { data: workspaces } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("INSTANTLY");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"available" | "connected" | null>(null);

  const currentWorkspace = workspaces?.find(
    (w: { id: string; slackWebhookUrl?: string | null }) => w.id === workspaceId
  );
  const savedSlackUrl = currentWorkspace?.slackWebhookUrl ?? null;

  const saveSlackMutation = useMutation({
    mutationFn: async (url: string | null) => {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: url }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setOpen(false);
      toast.success(slackWebhookUrl ? "Slack connected!" : "Slack disconnected");
    },
    onError: () => toast.error("Failed to save Slack webhook"),
  });

  function openAddDialog(p: ProviderId) {
    setProvider(p);
    setName("");
    setApiKey("");
    if (p === "SLACK") setSlackWebhookUrl(savedSlackUrl ?? "");
    setOpen(true);
  }

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
      const isOutbound = provider === "BLITZ" || provider === "APOLLO";
      toast.success(
        isOutbound
          ? "Integration added! You can now use it to enrich leads."
          : "Integration added! Syncing previous conversations in the background..."
      );
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

  const selectedProviderMeta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const connectedCount = integrations?.length ?? 0;
  const resolvedTab: "available" | "connected" =
    activeTab ?? (connectedCount > 0 ? "connected" : "available");

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect outreach tools to sync messages, or enrichment providers to fill missing lead data on demand.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("available")}
          className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            resolvedTab === "available"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Available providers
          {resolvedTab === "available" && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("connected")}
          className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            resolvedTab === "connected"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Connected
          {connectedCount > 0 && (
            <Badge
              variant={resolvedTab === "connected" ? "default" : "secondary"}
              className="text-[10px] h-5 px-1.5"
            >
              {connectedCount}
            </Badge>
          )}
          {resolvedTab === "connected" && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
          )}
        </button>
      </div>

      <Card className={`mb-8 ${resolvedTab === "available" ? "" : "hidden"}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Available providers</CardTitle>
          <CardDescription>Pick a tool to connect. You can add multiple accounts of the same provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS.map((p) => {
              const list = (integrations ?? []) as { provider: string }[];
              const count = p.id === "SLACK" ? (savedSlackUrl ? 1 : 0) : list.filter((i) => i.provider === p.id).length;
              const isEnrichment = p.kind === "Enrichment";
              const isNotification = p.kind === "Notifications";
              return (
                <button
                  key={p.id}
                  onClick={() => openAddDialog(p.id)}
                  className="group flex flex-col items-start text-left p-4 rounded-lg border bg-background hover:border-primary/50 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white border overflow-hidden">
                        <Image src={p.logo} alt={p.name} width={28} height={28} className="object-contain" />
                      </div>
                      <span className="font-medium text-sm">{p.name}</span>
                    </div>
                    {count > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-5">
                        {count}
                      </Badge>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] mb-2 ${
                      isEnrichment
                        ? "border-purple-500/40 text-purple-700 dark:text-purple-400"
                        : isNotification
                        ? "border-green-500/40 text-green-700 dark:text-green-400"
                        : "border-blue-500/40 text-blue-700 dark:text-blue-400"
                    }`}
                  >
                    {p.kind}
                  </Badge>
                  <p className="text-xs text-muted-foreground mb-3 leading-snug">{p.description}</p>
                  <div className="mt-auto text-[11px] font-medium text-primary group-hover:underline">
                    {p.id === "SLACK"
                      ? (savedSlackUrl ? "Edit webhook" : "+ Connect")
                      : count === 0 ? "+ Add" : "+ Add another"}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-white border overflow-hidden">
                <Image src={selectedProviderMeta.logo} alt={selectedProviderMeta.name} width={20} height={20} className="object-contain" />
              </div>
              {provider === "SLACK" ? (savedSlackUrl ? "Edit Slack Webhook" : "Connect Slack") : `Add ${selectedProviderMeta.name}`}
            </DialogTitle>
            <DialogDescription>
              {provider === "SLACK"
                ? "Paste your Slack Incoming Webhook URL. Follow-up reminders will be posted to the linked channel every 5 minutes."
                : selectedProviderMeta.kind === "Inbound sync"
                ? "Syncs replies and conversations into your inbox."
                : "Used to enrich missing lead data on demand from the Leads page."}
            </DialogDescription>
          </DialogHeader>

          {provider === "SLACK" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Incoming Webhook URL</Label>
                <Input
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Create one at <span className="font-mono">api.slack.com/apps</span> → Your App → Incoming Webhooks.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => saveSlackMutation.mutate(slackWebhookUrl || null)}
                  disabled={saveSlackMutation.isPending}
                >
                  {saveSlackMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save
                </Button>
                {savedSlackUrl && (
                  <Button
                    variant="outline"
                    onClick={() => saveSlackMutation.mutate(null)}
                    disabled={saveSlackMutation.isPending}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
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
                Add {selectedProviderMeta.name}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Card className={resolvedTab === "connected" ? "" : "hidden"}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connected integrations</CardTitle>
          <CardDescription>
            {integrations?.length
              ? `${integrations.length} ${integrations.length === 1 ? "integration" : "integrations"} connected to this workspace.`
              : "No integrations connected yet — switch to Available providers to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : integrations?.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <Plug className="h-4 w-4" />
          Pick a provider above to connect your first integration.
        </div>
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
            }) => {
              const isInbound = int.provider === "INSTANTLY" || int.provider === "HEYREACH" || int.provider === "LEMLIST";
              const supportsEnrich = int.provider === "INSTANTLY" || int.provider === "HEYREACH";
              return (
              <Card key={int.id} className={`bg-muted/20 shadow-none ${!int.isActive ? "opacity-70" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const meta = PROVIDERS.find((p) => p.id === int.provider);
                        return meta ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded bg-white border overflow-hidden shrink-0">
                            <Image src={meta.logo} alt={meta.name} width={24} height={24} className="object-contain" />
                          </div>
                        ) : null;
                      })()}
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
                      {isInbound && (
                        <>
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
                          {supportsEnrich && (
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
                          )}
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
                        </>
                      )}
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
                {isInbound ? (
                  <CardContent>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {int.provider === "LEMLIST"
                          ? "Webhook URL (auto-registered with Lemlist)"
                          : `Webhook URL (paste this in ${int.provider === "INSTANTLY" ? "Instantly" : "HeyReach"})`}
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
                ) : (
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Used to enrich missing lead data on demand from the Leads page.
                      {int.provider === "BLITZ" && " Tried first; covers verified emails and US mobile phones."}
                      {int.provider === "APOLLO" && " Used as fallback when Blitz can't find a field; covers global phones and richer firmographics."}
                    </p>
                  </CardContent>
                )}
              </Card>
              );
            }
          )}
        </div>
      )}
        </CardContent>
      </Card>
    </div>
  );
}
