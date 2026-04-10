"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, Key, Brain, Sparkles, Check } from "lucide-react";

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

export default function AILabelingPage() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [openaiKey, setOpenaiKey] = useState("");

  const saveKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/openai`, {
        method: "POST",
        headers: {
          "x-workspace-id": workspaceId!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: openaiKey }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast.success("OpenAI API key saved and encrypted");
      setOpenaiKey("");
    },
    onError: () => toast.error("Failed to save key"),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">AI Labeling</h1>
        <p className="text-sm text-muted-foreground">
          Automatically classify incoming replies using AI
        </p>
      </div>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            OpenAI API Key
          </CardTitle>
          <CardDescription>
            Required for automatic message classification. We use gpt-4o-mini for
            fast, cost-effective labeling (~$2/month per 1,000 messages).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="font-mono"
              />
              <Button
                onClick={() => saveKey.mutate()}
                disabled={!openaiKey || saveKey.isPending}
                className="gap-1 shrink-0"
              >
                {saveKey.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your key is encrypted at rest using AES-256-GCM. It is never exposed to the frontend.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            How Auto-Labeling Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">1</span>
              </div>
              <p className="text-muted-foreground">
                When a new reply comes in via webhook (Instantly or HeyReach), it&apos;s stored and queued for classification.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">2</span>
              </div>
              <p className="text-muted-foreground">
                The message + thread context is sent to OpenAI (gpt-4o-mini) for classification.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">3</span>
              </div>
              <p className="text-muted-foreground">
                If confidence is &ge; 70%, the label is automatically applied. Low-confidence results are skipped.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Classification Categories
          </CardTitle>
          <CardDescription>
            The AI classifies each reply into one of these categories
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {LABEL_CATEGORIES.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3 py-1.5">
                <Badge
                  className="text-xs min-w-[100px] justify-center"
                  style={{ backgroundColor: cat.color, color: "white" }}
                >
                  {cat.name}
                </Badge>
                <span className="text-sm text-muted-foreground">{cat.description}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
