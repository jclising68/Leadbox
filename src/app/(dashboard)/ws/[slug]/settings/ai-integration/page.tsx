"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Key,
  Brain,
  Sparkles,
  CheckCircle2,
  Pencil,
  Trash2,
  Wand2,
  AlertTriangle,
  Info,
} from "lucide-react";

type Workspace = {
  aiLabelProvider?: string | null;
  aiReplyEnabled?: boolean;
  aiReplyMode?: string;
  aiReplyProvider?: string;
  aiReplyInstructions?: string | null;
  openaiKey?: string | null;
  claudeKey?: string | null;
};

const LABEL_CATEGORIES = [
  { name: "Interested", color: "#22C55E", description: "Prospect shows interest, asks for more info" },
  { name: "Not Interested", color: "#EF4444", description: "Explicit rejection, unsubscribe request" },
  { name: "Meeting Booked", color: "#3B82F6", description: "Agrees to a meeting, suggests times" },
  { name: "Qualifying", color: "#A855F7", description: "Asks qualifying questions about pricing, features" },
  { name: "Wrong Person", color: "#F97316", description: "Not the right contact, suggests someone else" },
  { name: "Out of Office", color: "#6B7280", description: "Auto-reply, vacation, OOO message" },
  { name: "Maybe Future", color: "#EAB308", description: "Not now but maybe later" },
  { name: "Auto Reply", color: "#EC4899", description: "Automated response, delivery confirmation" },
  { name: "Neutral", color: "#8B5CF6", description: "Acknowledgment without clear intent" },
];

type Tab = "ai-label" | "ai-reply";

export default function AIIntegrationPage() {
  const workspaceId = useCurrentWorkspaceId();
  const workspace = useCurrentWorkspace() as Workspace | null;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("ai-label");

  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [claudeKeyInput, setClaudeKeyInput] = useState("");
  const [editingOpenai, setEditingOpenai] = useState(false);
  const [editingClaude, setEditingClaude] = useState(false);

  const headers = { "x-workspace-id": workspaceId!, "Content-Type": "application/json" };
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["workspaces"] });

  const patchWorkspace = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const saveOpenaiKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/openai`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey: openaiKeyInput }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      toast.success("OpenAI API key saved");
      setOpenaiKeyInput("");
      setEditingOpenai(false);
      invalidate();
    },
    onError: () => toast.error("Failed to save OpenAI key"),
  });

  const deleteOpenaiKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/openai`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      toast.success("OpenAI API key removed");
      setEditingOpenai(false);
      invalidate();
    },
    onError: () => toast.error("Failed to remove key"),
  });

  const saveClaudeKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/claude`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey: claudeKeyInput }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      toast.success("Claude API key saved");
      setClaudeKeyInput("");
      setEditingClaude(false);
      invalidate();
    },
    onError: () => toast.error("Failed to save Claude key"),
  });

  const deleteClaudeKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/claude`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      toast.success("Claude API key removed");
      setEditingClaude(false);
      invalidate();
    },
    onError: () => toast.error("Failed to remove key"),
  });

  const aiLabelProvider = workspace?.aiLabelProvider ?? "openai";
  const aiReplyEnabled = workspace?.aiReplyEnabled ?? false;
  const aiReplyMode = workspace?.aiReplyMode ?? "HUMAN_IN_LOOP";
  const aiReplyProvider = workspace?.aiReplyProvider ?? "openai";
  const aiReplyInstructions = workspace?.aiReplyInstructions ?? "";
  const openaiConnected = Boolean(workspace?.openaiKey);
  const claudeConnected = Boolean(workspace?.claudeKey);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">AI Integration</h1>
        <p className="text-sm text-muted-foreground">
          Configure AI-powered labeling and reply drafting for your inbox
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-1">
        {(["ai-label", "ai-reply"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "ai-label" ? "AI Label" : "AI Reply"}
          </button>
        ))}
      </div>

      {/* ── AI Label tab ── */}
      {activeTab === "ai-label" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                AI Provider
              </CardTitle>
              <CardDescription>
                Choose which AI model to use for classifying replies. Keys are shared with AI Reply if already connected.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={aiLabelProvider}
                  onValueChange={(v) => patchWorkspace.mutate({ aiLabelProvider: v })}
                  disabled={patchWorkspace.isPending}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue>
                      {aiLabelProvider === "claude" ? "Claude Sonnet 4.6 (Anthropic)" : "GPT-4o Mini (OpenAI)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">GPT-4o Mini (OpenAI)</SelectItem>
                    <SelectItem value="claude">Claude Sonnet 4.6 (Anthropic)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {aiLabelProvider === "openai" && (
                <div className="space-y-2">
                  <Label>OpenAI API Key</Label>
                  {openaiConnected && !editingOpenai ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Connected
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditingOpenai(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteOpenaiKey.mutate()} disabled={deleteOpenaiKey.isPending}>
                        {deleteOpenaiKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input type="password" value={openaiKeyInput} onChange={(e) => setOpenaiKeyInput(e.target.value)} placeholder="sk-..." className="font-mono" autoFocus={editingOpenai} />
                        <Button onClick={() => saveOpenaiKey.mutate()} disabled={!openaiKeyInput || saveOpenaiKey.isPending} className="gap-1 shrink-0">
                          {saveOpenaiKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                        {editingOpenai && <Button variant="ghost" onClick={() => { setEditingOpenai(false); setOpenaiKeyInput(""); }}>Cancel</Button>}
                      </div>
                      <p className="text-xs text-muted-foreground">Encrypted at rest using AES-256-GCM. Shared with AI Reply.</p>
                    </div>
                  )}
                </div>
              )}

              {aiLabelProvider === "claude" && (
                <div className="space-y-2">
                  <Label>Claude API Key</Label>
                  {claudeConnected && !editingClaude ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Connected
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditingClaude(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteClaudeKey.mutate()} disabled={deleteClaudeKey.isPending}>
                        {deleteClaudeKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input type="password" value={claudeKeyInput} onChange={(e) => setClaudeKeyInput(e.target.value)} placeholder="sk-ant-..." className="font-mono" autoFocus={editingClaude} />
                        <Button onClick={() => saveClaudeKey.mutate()} disabled={!claudeKeyInput || saveClaudeKey.isPending} className="gap-1 shrink-0">
                          {saveClaudeKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                        {editingClaude && <Button variant="ghost" onClick={() => { setEditingClaude(false); setClaudeKeyInput(""); }}>Cancel</Button>}
                      </div>
                      <p className="text-xs text-muted-foreground">Encrypted at rest using AES-256-GCM. Shared with AI Reply.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" />
                How Auto-Labeling Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm">
                {[
                  "When a new reply comes in via webhook (Instantly, HeyReach, or Lemlist), it's stored for classification.",
                  `The message + thread context is sent to ${aiLabelProvider === "claude" ? "Claude Sonnet 4.6 (Anthropic)" : "GPT-4o Mini (OpenAI)"} for classification.`,
                  "If confidence is ≥ 70%, the label is automatically applied. Low-confidence results are skipped.",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-medium text-primary">{i + 1}</span>
                    </div>
                    <p className="text-muted-foreground">{step}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Classification Categories
              </CardTitle>
              <CardDescription>The AI classifies each reply into one of these categories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {LABEL_CATEGORIES.map((cat) => (
                  <div key={cat.name} className="flex items-center gap-3 py-1.5">
                    <Badge className="text-xs min-w-[100px] justify-center" style={{ backgroundColor: cat.color, color: "white" }}>
                      {cat.name}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{cat.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── AI Reply tab ── */}
      {activeTab === "ai-reply" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Enable AI Reply Drafting
              </CardTitle>
              <CardDescription>
                When enabled, an AI agent drafts a contextual reply as soon as any lead responds.
                Drafts appear pre-filled in the reply composer for your team to review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch
                  id="ai-reply-enabled"
                  checked={aiReplyEnabled}
                  onCheckedChange={(v) => patchWorkspace.mutate({ aiReplyEnabled: v })}
                  disabled={patchWorkspace.isPending}
                />
                <Label htmlFor="ai-reply-enabled" className="cursor-pointer">
                  {aiReplyEnabled ? "Enabled" : "Disabled"}
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reply Mode</CardTitle>
              <CardDescription>Choose whether AI drafts require human approval before sending</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={aiReplyMode}
                onValueChange={(v) => patchWorkspace.mutate({ aiReplyMode: v })}
                disabled={patchWorkspace.isPending}
              >
                <SelectTrigger className="w-64">
                  <SelectValue>
                    {aiReplyMode === "AUTO_REPLY" ? "Auto Reply" : "Human in the Loop"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HUMAN_IN_LOOP">Human in the Loop (recommended)</SelectItem>
                  <SelectItem value="AUTO_REPLY">Auto Reply</SelectItem>
                </SelectContent>
              </Select>
              {aiReplyMode === "AUTO_REPLY" && (
                <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p><strong>Auto Reply is active.</strong> AI-drafted replies will be sent immediately without human review.</p>
                </div>
              )}
              {aiReplyMode === "HUMAN_IN_LOOP" && (
                <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>AI drafts appear pre-filled in the reply composer. Your team reviews and hits Send.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI Provider</CardTitle>
              <CardDescription>Choose which AI model generates reply drafts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={aiReplyProvider}
                onValueChange={(v) => patchWorkspace.mutate({ aiReplyProvider: v })}
                disabled={patchWorkspace.isPending}
              >
                <SelectTrigger className="w-64">
                  <SelectValue>
                    {aiReplyProvider === "claude" ? "Claude (claude-sonnet-4-6)" : "OpenAI (gpt-4o-mini)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI (gpt-4o-mini)</SelectItem>
                  <SelectItem value="claude">Claude (claude-sonnet-4-6)</SelectItem>
                </SelectContent>
              </Select>

              {aiReplyProvider === "claude" && (
                <div className="space-y-2">
                  <Label>Claude API Key</Label>
                  {claudeConnected && !editingClaude ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Connected
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditingClaude(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteClaudeKey.mutate()} disabled={deleteClaudeKey.isPending}>
                        {deleteClaudeKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input type="password" value={claudeKeyInput} onChange={(e) => setClaudeKeyInput(e.target.value)} placeholder="sk-ant-..." className="font-mono" autoFocus={editingClaude} />
                        <Button onClick={() => saveClaudeKey.mutate()} disabled={!claudeKeyInput || saveClaudeKey.isPending} className="gap-1 shrink-0">
                          {saveClaudeKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                        {editingClaude && <Button variant="ghost" onClick={() => { setEditingClaude(false); setClaudeKeyInput(""); }}>Cancel</Button>}
                      </div>
                      <p className="text-xs text-muted-foreground">Encrypted at rest using AES-256-GCM. Shared with AI Label.</p>
                    </div>
                  )}
                </div>
              )}

              {aiReplyProvider === "openai" && (
                <div className="space-y-2">
                  <Label>OpenAI API Key</Label>
                  {openaiConnected && !editingOpenai ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Connected
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditingOpenai(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteOpenaiKey.mutate()} disabled={deleteOpenaiKey.isPending}>
                        {deleteOpenaiKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input type="password" value={openaiKeyInput} onChange={(e) => setOpenaiKeyInput(e.target.value)} placeholder="sk-..." className="font-mono" autoFocus={editingOpenai} />
                        <Button onClick={() => saveOpenaiKey.mutate()} disabled={!openaiKeyInput || saveOpenaiKey.isPending} className="gap-1 shrink-0">
                          {saveOpenaiKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                        {editingOpenai && <Button variant="ghost" onClick={() => { setEditingOpenai(false); setOpenaiKeyInput(""); }}>Cancel</Button>}
                      </div>
                      <p className="text-xs text-muted-foreground">Encrypted at rest using AES-256-GCM. Shared with AI Label.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI Instructions</CardTitle>
              <CardDescription>Describe your company, persona, and goal — injected into every draft prompt</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                defaultValue={aiReplyInstructions}
                placeholder="e.g. You are a friendly SDR at AcmeCo selling HR software. Goal is to book a 15-min demo. Keep replies under 100 words and address the lead's question directly."
                className="min-h-[100px] resize-none"
                onBlur={(e) => patchWorkspace.mutate({ aiReplyInstructions: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The AI also uses the full conversation history, lead name, company, title, and campaign name as context automatically.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4" />
                How It Works
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm">
                {[
                  "A lead replies to your outreach via Instantly, HeyReach, or Lemlist.",
                  "The AI reads the full conversation history, lead details, and campaign name to draft a contextual reply.",
                  "Human in the Loop: the draft appears pre-filled in the reply composer. Your team edits and clicks Send.",
                  "Auto Reply: the reply is sent immediately. Unsubscribed leads are always skipped.",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-medium text-primary">{i + 1}</span>
                    </div>
                    <p className="text-muted-foreground">{step}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
