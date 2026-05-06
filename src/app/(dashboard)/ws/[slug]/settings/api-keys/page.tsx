"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Copy, Check, Key } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function ApiKeysPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) return { keys: [] };
      return res.json() as Promise<{ keys: ApiKey[] }>;
    },
    enabled: !!workspaceId,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId!,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create key");
      }
      return res.json() as Promise<{ key: string; prefix: string; name: string }>;
    },
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys", workspaceId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys/${keyId}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) throw new Error("Failed to revoke key");
    },
    onSuccess: () => {
      toast.success("API key revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys", workspaceId] });
    },
    onError: () => {
      toast.error("Failed to revoke key");
    },
  });

  const keys = data?.keys ?? [];

  const mcpUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/mcp`
    : "/api/mcp";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate keys to allow AI agents (e.g. Sofia) to access your LeadBox inbox via the MCP server.
        </p>
      </div>

      {/* MCP connection info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">MCP Server</CardTitle>
          <CardDescription className="text-xs">
            Connect AI agents using this endpoint with your API key as a Bearer token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">MCP endpoint</p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted px-2 py-1.5 rounded flex-1 truncate">{mcpUrl}</code>
              <CopyButton text={mcpUrl} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Authorization header</p>
            <code className="text-xs bg-muted px-2 py-1.5 rounded block">Authorization: Bearer {"<your-api-key>"}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            <strong>Available tools:</strong> list_threads · get_thread · send_reply · apply_label · mark_thread_read · unsubscribe_contact
          </div>
        </CardContent>
      </Card>

      {/* Create new key */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Create API Key</CardTitle>
          <CardDescription className="text-xs">
            Give the key a name to identify which agent or integration will use it.
            Requires Admin role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Sofia — Lead Assassin"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newKeyName.trim() && !createMutation.isPending) {
                  createMutation.mutate(newKeyName.trim());
                }
              }}
              className="text-sm h-9"
              maxLength={80}
            />
            <Button
              size="sm"
              onClick={() => createMutation.mutate(newKeyName.trim())}
              disabled={!newKeyName.trim() || createMutation.isPending}
              className="shrink-0"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active keys list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Key className="h-8 w-8 opacity-30" />
          <p className="text-sm">No API keys yet. Generate one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active keys</p>
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{key.name}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {key.keyPrefix}••••••••••••••••
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {key.lastUsedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                  </span>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">Never used</Badge>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Revoke "${key.name}"? This cannot be undone.`)) {
                      revokeMutation.mutate(key.id);
                    }
                  }}
                  disabled={revokeMutation.isPending}
                  className={cn(
                    "p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors",
                  )}
                  title="Revoke key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Show created key once dialog */}
      <Dialog open={!!createdKey} onOpenChange={(v) => !v && setCreatedKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Key Created
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy this key now — it will not be shown again.
            </p>
            <div className="bg-muted rounded-lg p-3">
              <p className="font-mono text-xs break-all select-all">{createdKey}</p>
            </div>
            <div className="flex gap-2">
              <CopyButton text={createdKey ?? ""} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreatedKey(null)}
                className="ml-auto"
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
