"use client";

import { useState } from "react";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart2, ExternalLink, Pencil, X } from "lucide-react";

type Workspace = {
  id: string;
  name: string;
  kpiEmbedToken?: string | null;
  members?: { role: string }[];
};

export default function KpiPage() {
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const queryClient = useQueryClient();

  const activeWorkspace = workspaces?.find(
    (w: { id: string }) => w.id === activeWorkspaceId
  ) as Workspace | undefined;

  const token = activeWorkspace?.kpiEmbedToken ?? null;
  const role = activeWorkspace?.members?.[0]?.role ?? "MEMBER";
  const canEdit = role === "OWNER" || role === "ADMIN";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function extractToken(value: string): string {
    const trimmed = value.trim();
    const prefix = "https://www.leadassassin.app/embed/";
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
    return trimmed;
  }

  async function save() {
    if (!activeWorkspace) return;
    setSaving(true);
    setSaveError(null);
    const tokenValue = extractToken(draft) || null;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiEmbedToken: tokenValue }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setEditing(false);
      setDraft("");
    } catch {
      setSaveError("Could not save token. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit() {
    setDraft(token ?? "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
    setSaveError(null);
  }

  if (!activeWorkspace) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">KPI Dashboard</h1>
        </div>
        {token && canEdit && !editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Change token
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {token && !editing ? (
          /* Embed iframe */
          <iframe
            src={`https://www.leadassassin.app/embed/${token}`}
            className="w-full h-full border-0"
            allow="clipboard-write"
            title="KPI Dashboard"
          />
        ) : !editing ? (
          /* No token placeholder */
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-xs px-4">
              <BarChart2 className="h-10 w-10 text-muted-foreground mx-auto" />
              <div>
                <p className="text-sm font-medium">No KPI token configured</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {canEdit
                    ? "Paste your embed token from the KPI app to display the scorecard here."
                    : "Ask your workspace admin to configure the KPI embed token."}
                </p>
              </div>
              {canEdit && (
                <button
                  onClick={startEdit}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  Add token
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Inline token form (first-time setup — no existing token to show behind modal) */
          <div className="flex items-center justify-center h-full">
            <div className="w-full max-w-md px-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">
                  KPI Embed Token
                </label>
                <input
                  autoFocus
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && draft.trim() && save()}
                  placeholder="Paste token here…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                {draft.trim() && (
                  <p className="mt-1 text-xs text-muted-foreground break-all">
                    https://www.leadassassin.app/embed/{extractToken(draft)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span>Generate tokens in the KPI app</span>
              </div>
              {saveError && <p className="text-xs text-destructive">{saveError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving || !draft.trim()}
                  className="flex-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  className="flex-1 px-3 py-1.5 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal for changing an existing token (iframe still shows behind) */}
      {editing && token && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border border-border shadow-lg w-full max-w-md mx-4 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Change KPI Token</h2>
              <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1.5">
                Embed Token
              </label>
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && draft.trim() && save()}
                placeholder="Paste new token…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              {draft.trim() && (
                <p className="mt-1 text-xs text-muted-foreground break-all">
                  https://www.leadassassin.app/embed/{extractToken(draft)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span>Generate tokens in the KPI app</span>
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving || !draft.trim()}
                className="flex-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                className="flex-1 px-3 py-1.5 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
