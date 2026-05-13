"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Paperclip, X, Loader2, Send } from "lucide-react";

type Attachment = { name: string; url: string; type: string };
type SmtpChannel = { id: string; email: string; displayName: string | null };

interface ComposeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ComposeDialog({ open, onClose }: ComposeDialogProps) {
  const workspaceId = useCurrentWorkspaceId();
  const qc = useQueryClient();
  const attachFileRef = useRef<HTMLInputElement>(null);

  const [fromEmail, setFromEmail] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const { data: channelsData } = useQuery<{ channels: SmtpChannel[] }>({
    queryKey: ["smtp-channels", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/smtp-channels", {
        headers: { "x-workspace-id": workspaceId! },
      });
      return res.json();
    },
    enabled: !!workspaceId && open,
  });
  const channels = channelsData?.channels ?? [];

  function handleClose() {
    setToEmail("");
    setSubject("");
    setBody("");
    setAttachments([]);
    onClose();
  }

  async function handleAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !workspaceId) return;
    e.target.value = "";
    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("threadId", "compose");
      const res = await fetch("/api/attachments", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: form,
      });
      const json = await res.json() as { url?: string; name?: string; type?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setAttachments((prev) => [...prev, { name: json.name!, url: json.url!, type: json.type! }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleSend() {
    if (!fromEmail || !toEmail || !body.trim()) {
      toast.error("From, To, and message body are required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId! },
        body: JSON.stringify({ fromEmail, toEmail, subject, body, attachments }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to send");
      toast.success("Email sent");
      qc.invalidateQueries({ queryKey: ["threads"] });
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* From */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <select
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">Select sending mailbox…</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.email}>
                  {ch.displayName ? `${ch.displayName} <${ch.email}>` : ch.email}
                </option>
              ))}
            </select>
            {channels.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No mailboxes connected. Import them in Settings → Channels.
              </p>
            )}
          </div>

          {/* To */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="email"
              placeholder="recipient@example.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              className="text-sm h-9"
            />
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Input
              placeholder="(no subject)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="text-sm h-9"
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Message</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] max-h-[240px] resize-none focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground"
              placeholder="Write your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted border border-border max-w-[200px]"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <input ref={attachFileRef} type="file" className="hidden" onChange={handleAttachFile} />
              <button
                type="button"
                disabled={uploadingFile || sending}
                onClick={() => attachFileRef.current?.click()}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                title="Attach file"
              >
                {uploadingFile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose} disabled={sending}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSend}
                disabled={sending || !fromEmail || !toEmail || !body.trim()}
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
