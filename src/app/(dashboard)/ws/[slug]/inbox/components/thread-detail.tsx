"use client";

import { useThread, useUpdateThread, useAddLabel, useRemoveLabel, useSendReply } from "@/hooks/use-threads";
import { useLabels } from "@/hooks/use-labels";
import { useInboxStore } from "@/stores/inbox-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  X,
  Sparkles,
  Archive,
  Trash2,
  AlertCircle,
  Tag,
  Inbox,
  Mail,
  Link2,
  Loader2,
  User,
  Building,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  ShieldCheck,
  Clock,
  Globe,
  Briefcase,
  Zap,
  Copy,
  Phone,
  FileText,
  MessageSquare,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 group/row">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1">
          <p className="text-sm truncate flex-1">{value}</p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(value);
              toast.success("Copied!");
            }}
            className="opacity-0 group-hover/row:opacity-100 shrink-0 text-muted-foreground hover:text-foreground transition-opacity"
            title="Copy"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_META: Record<string, { src: string; label: string }> = {
  INSTANTLY: { src: "/branding/instantly.png", label: "Instantly" },
  HEYREACH:  { src: "/branding/heyreach.png",  label: "HeyReach" },
  LEMLIST:   { src: "/branding/lemlist.svg",   label: "Lemlist" },
};

function ProviderBadge({ provider }: { provider?: string | null }) {
  if (!provider) return null;
  const meta = PROVIDER_META[provider];
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset bg-muted/60 text-muted-foreground ring-border">
      <Image src={meta.src} alt={meta.label} width={12} height={12} className="object-contain" />
      {meta.label}
    </span>
  );
}

export function ThreadDetail() {
  const { selectedThreadId, setSelectedThread } = useInboxStore();
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const { data: thread, isLoading, refetch: refetchThread, isFetching: isRefetchingThread } = useThread(selectedThreadId);
  const { data: labels } = useLabels();
  const updateThread = useUpdateThread();
  const addLabel = useAddLabel();
  const removeLabel = useRemoveLabel();
  const sendReply = useSendReply();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [replyText, setReplyText] = useState("");
  const [draftApplied, setDraftApplied] = useState(false);

  // Fetch AI draft for the current thread
  const { data: aiDraft } = useQuery({
    queryKey: ["ai-draft", selectedThreadId],
    queryFn: async () => {
      if (!workspaceId || !selectedThreadId) return null;
      const res = await fetch(`/api/threads/${selectedThreadId}/draft`, {
        headers: { "x-workspace-id": workspaceId },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{ id: string; body: string; status: string; model: string } | null>;
    },
    enabled: !!workspaceId && !!selectedThreadId,
    refetchInterval: (query) => {
      // Poll until draft is no longer PENDING
      return query.state.data?.status === "PENDING" ? 3000 : false;
    },
    staleTime: 0,
  });

  // Pre-fill composer when a READY draft arrives and user hasn't typed anything
  useEffect(() => {
    if (aiDraft?.status === "READY" && !draftApplied && !replyText) {
      setReplyText(aiDraft.body);
      setDraftApplied(true);
    }
  }, [aiDraft?.status, aiDraft?.body, draftApplied, replyText]);

  // Clear reply draft when switching threads
  useEffect(() => {
    setReplyText("");
    setDraftApplied(false);
  }, [selectedThreadId]);

  // Mark as read when viewing
  useEffect(() => {
    if (thread?.isUnread && selectedThreadId) {
      updateThread.mutate({ threadId: selectedThreadId, data: { isUnread: false } });
    }
  }, [thread?.isUnread, selectedThreadId]);

  // Scroll to bottom when thread loads
  useEffect(() => {
    if (thread?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [thread?.id, thread?.messages?.length]);

  if (!selectedThreadId) return null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Thread not found
      </div>
    );
  }

  const currentLabelIds = new Set(
    thread.threadLabels?.map((tl: { label: { id: string } }) => tl.label.id) || []
  );
  const availableLabels = labels?.filter((l: { id: string }) => !currentLabelIds.has(l.id));

  const prospectName = thread.prospect.firstName || thread.prospect.lastName
    ? `${thread.prospect.firstName || ""} ${thread.prospect.lastName || ""}`.trim()
    : thread.prospect.email || "Unknown";

  // Prefer the provider from an INBOUND reply (who they responded to),
  // fall back to the oldest message (original acquisition tool).
  const primaryProvider =
    thread.messages?.find((m: { direction: string }) => m.direction === "INBOUND")?.integration?.provider
    ?? thread.messages?.[0]?.integration?.provider;

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Message area - center */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-background">
        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0 bg-card/40">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedThread(null)}>
              <X className="h-4 w-4" />
            </Button>
            <ChevronUp className="h-4 w-4 text-muted-foreground cursor-pointer" />
            <ChevronDown className="h-4 w-4 text-muted-foreground cursor-pointer" />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Refresh"
              onClick={() => refetchThread()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted">
                <Tag className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {availableLabels?.map((label: { id: string; name: string; color: string }) => (
                  <DropdownMenuItem
                    key={label.id}
                    onClick={() => addLabel.mutate({ threadId: thread.id, labelId: label.id })}
                  >
                    <span className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: label.color }} />
                    {label.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              title={thread.isUnread ? "Mark as read" : "Mark as unread"}
              onClick={() => {
                updateThread.mutate({ threadId: thread.id, data: { isUnread: !thread.isUnread } });
                toast.success(thread.isUnread ? "Marked as read" : "Marked as unread");
              }}
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>

            {/* Context-aware action buttons */}
            {thread.status === "OPEN" && (
              <>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7" title="Mark as spam"
                  onClick={() => {
                    updateThread.mutate({ threadId: thread.id, data: { status: "SPAM" } });
                    toast.success("Moved to spam");
                  }}
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7" title="Archive"
                  onClick={() => {
                    updateThread.mutate({ threadId: thread.id, data: { status: "ARCHIVED" } });
                    toast.success("Moved to archive");
                  }}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7" title="Trash"
                  onClick={() => {
                    updateThread.mutate({ threadId: thread.id, data: { status: "TRASH" } });
                    toast.success("Moved to trash");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}

            {thread.status === "ARCHIVED" && (
              <Button
                variant="ghost" size="icon" className="h-7 w-7" title="Move to Inbox"
                onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "OPEN" } });
                  toast.success("Restored to inbox");
                }}
              >
                <Inbox className="h-3.5 w-3.5" />
              </Button>
            )}

            {thread.status === "SPAM" && (
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="Not Spam"
                onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "OPEN" } });
                  toast.success("Marked as not spam — restored to inbox");
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Not Spam
              </Button>
            )}

            {thread.status === "TRASH" && (
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="Restore"
                onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "OPEN" } });
                  toast.success("Restored to inbox");
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-muted border">
                Move To
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "OPEN" } });
                  toast.success("Moved to inbox");
                }}>
                  <Inbox className="h-3.5 w-3.5 mr-2" /> Inbox
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "ARCHIVED" } });
                  toast.success("Moved to archive");
                }}>
                  <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "SPAM" } });
                  toast.success("Moved to spam");
                }}>
                  <AlertCircle className="h-3.5 w-3.5 mr-2" /> Spam
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  updateThread.mutate({ threadId: thread.id, data: { status: "TRASH" } });
                  toast.success("Moved to trash");
                }}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Sender info bar */}
        <div className="px-6 py-2.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {thread.messages?.[0]?.fromEmail || thread.prospect.email || ""}
            </span>
            <ProviderBadge provider={primaryProvider} />
          </div>
          <div className="flex items-center gap-2">
            {thread.channel === "EMAIL" ? (
              <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                <Mail className="h-3 w-3" /> Email
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                <Link2 className="h-3 w-3" /> LinkedIn
              </Badge>
            )}
          </div>
        </div>

        {/* Scrollable messages area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 space-y-6 max-w-3xl">
            {thread.messages?.map(
              (msg: {
                id: string;
                direction: string;
                channel: string;
                subject: string | null;
                bodyText: string | null;
                bodyHtml: string | null;
                messageText: string | null;
                fromEmail: string | null;
                campaignName: string | null;
                sentAt: string | null;
                receivedAt: string;
                integration: { name: string; provider: string } | null;
              }) => (
                <div
                  key={msg.id}
                  className={cn(
                    "group flex flex-col",
                    msg.direction === "INBOUND" ? "items-start" : "items-end"
                  )}
                >
                  {/* Header: sender + timestamp. Order flips per side so the
                      avatar always sits on the outside (classic chat layout). */}
                  <div
                    className={cn(
                      "flex items-center gap-3 mb-2 max-w-[80%]",
                      msg.direction === "INBOUND" ? "flex-row" : "flex-row-reverse"
                    )}
                  >
                    {msg.direction === "INBOUND" ? (
                      <div className="w-8 h-8 rounded-full bg-muted ring-1 ring-inset ring-border flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-foreground/80">
                          {(thread.prospect.firstName?.[0] || thread.prospect.email?.[0] || "?").toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-semibold">You</span>
                      </div>
                    )}
                    <div className={cn("min-w-0", msg.direction === "INBOUND" ? "text-left" : "text-right")}>
                      <div
                        className={cn(
                          "flex items-center gap-2",
                          msg.direction === "INBOUND" ? "" : "flex-row-reverse"
                        )}
                      >
                        <span className="text-sm font-medium">
                          {msg.direction === "INBOUND" ? prospectName : (msg.fromEmail || "You")}
                        </span>
                        {msg.integration && (
                          <ProviderBadge provider={msg.integration.provider} />
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(msg.sentAt || msg.receivedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Bubble: prospect messages sit on a neutral surface; our
                      replies use the primary fill. Caps at 80% width so long
                      messages wrap instead of spanning the whole pane. */}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[80%] ring-1 ring-inset",
                      msg.direction === "INBOUND"
                        ? "bg-card ring-border rounded-tl-sm ml-11 text-foreground"
                        : "bg-primary text-primary-foreground ring-primary/0 rounded-tr-sm mr-11"
                    )}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {msg.bodyText || msg.messageText || msg.subject || "No content"}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* Label activity */}
            {thread.threadLabels?.map((tl: {
              id: string;
              source: string;
              appliedAt: string;
              label: { name: string; color: string };
            }) => (
              <div key={tl.id} className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tl.label.color }} />
                <span>
                  Label <strong>{tl.label.name}</strong> applied
                  {tl.source === "AUTO_AI" && " by AI"}
                  {tl.source === "WEBHOOK" && " automatically"}
                </span>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Reply composer */}
        <div className="border-t border-border bg-card/40 px-4 py-3 shrink-0">
          {/* AI Draft badge row */}
          {aiDraft?.status === "PENDING" && (
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating AI Draft…
            </div>
          )}
          {aiDraft?.status === "READY" && draftApplied && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-1 ring-inset ring-violet-500/25">
                <Sparkles className="h-2.5 w-2.5" />
                AI Draft
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={async () => {
                  setReplyText("");
                  setDraftApplied(false);
                  if (workspaceId && selectedThreadId) {
                    await fetch(`/api/threads/${selectedThreadId}/draft`, {
                      method: "DELETE",
                      headers: { "x-workspace-id": workspaceId },
                    });
                    queryClient.invalidateQueries({ queryKey: ["ai-draft", selectedThreadId] });
                  }
                }}
              >
                Discard
              </button>
            </div>
          )}
          <textarea
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[60px] max-h-[160px] resize-none focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring/60 placeholder:text-muted-foreground transition-colors"
            placeholder={
              aiDraft?.status === "PENDING"
                ? "AI is drafting a reply…"
                : thread?.channel === "LINKEDIN"
                ? "Type your LinkedIn message..."
                : "Type your reply..."
            }
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && replyText.trim() && !sendReply.isPending) {
                sendReply.mutate(
                  { threadId: selectedThreadId!, body: replyText.trim() },
                  {
                    onSuccess: () => {
                      setReplyText("");
                      setDraftApplied(false);
                      toast.success("Message sent");
                    },
                    onError: (err) => toast.error(err.message),
                  }
                );
              }
            }}
            disabled={sendReply.isPending}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground">
              {thread?.channel === "LINKEDIN" ? "LinkedIn message" : "Email reply"} · Cmd+Enter to send
            </span>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!replyText.trim() || sendReply.isPending}
              onClick={() => {
                sendReply.mutate(
                  { threadId: selectedThreadId!, body: replyText.trim() },
                  {
                    onSuccess: () => {
                      setReplyText("");
                      setDraftApplied(false);
                      toast.success("Message sent");
                    },
                    onError: (err) => toast.error(err.message),
                  }
                );
              }}
            >
              {sendReply.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : thread?.channel === "LINKEDIN" ? (
                <Send className="h-3.5 w-3.5" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              {sendReply.isPending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>

      {/* Prospect details panel */}
      <div className="w-72 border-l border-border bg-card flex flex-col h-full overflow-hidden shrink-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold">Prospect details</h3>
          <button
            type="button"
            onClick={() => refetchThread()}
            disabled={isRefetchingThread}
            title="Refresh prospect details"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", isRefetchingThread && "animate-spin")} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-4 py-4">
            {/* Prospect card */}
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-muted ring-1 ring-inset ring-border flex items-center justify-center shrink-0">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold truncate">{prospectName}</h4>
                {thread.prospect.company && (
                  <p className="text-xs text-muted-foreground truncate">{thread.prospect.company}</p>
                )}
                {thread.prospect.title && (
                  <p className="text-xs text-muted-foreground truncate">{thread.prospect.title}</p>
                )}
              </div>
            </div>

            {/* Source + Channel */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <ProviderBadge provider={primaryProvider} />
              <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                {thread.channel === "EMAIL" ? <Mail className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                {thread.channel === "EMAIL" ? "Email" : "LinkedIn"}
              </Badge>
              {thread.prospect.leadStatus && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {thread.prospect.leadStatus}
                </Badge>
              )}
            </div>

            {/* Labels */}
            {thread.threadLabels?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {thread.threadLabels?.map((tl: {
                  id: string;
                  label: { id: string; name: string; color: string };
                }) => (
                  <Badge
                    key={tl.id}
                    className="text-xs gap-1 pr-1"
                    style={{ backgroundColor: tl.label.color, color: "white" }}
                  >
                    {tl.label.name}
                    <button
                      onClick={() => removeLabel.mutate({ threadId: thread.id, labelId: tl.label.id })}
                      className="ml-0.5 hover:bg-white/20 rounded p-0.5"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <Separator className="my-3" />

            {/* Contact Info */}
            <div className="space-y-2.5">
              <h5 className="text-xs font-semibold uppercase text-muted-foreground">Contact</h5>
              <DetailRow icon={Mail} label="Email" value={thread.prospect.email} />
              <DetailRow icon={Phone} label="Phone" value={thread.prospect.phone} />
              <DetailRow icon={Link2} label="LinkedIn" value={thread.prospect.linkedinUrl} />
            </div>

            <Separator className="my-3" />

            {/* Company Info */}
            <div className="space-y-2.5">
              <h5 className="text-xs font-semibold uppercase text-muted-foreground">Company</h5>
              <DetailRow icon={Building} label="Company" value={thread.prospect.company} />
              <DetailRow icon={Briefcase} label="Title" value={thread.prospect.title} />
              <DetailRow icon={Globe} label="Domain" value={thread.prospect.domain} />
            </div>

            <Separator className="my-3" />

            {/* Campaign Info */}
            <div className="space-y-2.5">
              <h5 className="text-xs font-semibold uppercase text-muted-foreground">Campaign</h5>
              <DetailRow icon={Globe} label="Campaign" value={thread.prospect.campaignName || thread.messages?.[0]?.campaignName} />
              <DetailRow icon={Zap} label="Step Replied" value={thread.prospect.stepReplied} />
              <div className="flex items-start gap-2">
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Messages</p>
                  <p className="text-sm">{thread.messageCount || thread.messages?.length || 0}</p>
                </div>
              </div>
            </div>

            {/* Notes & Feedback */}
            {(thread.prospect.notes || thread.prospect.feedback) && (
              <>
                <Separator className="my-3" />
                <div className="space-y-2.5">
                  <h5 className="text-xs font-semibold uppercase text-muted-foreground">Notes</h5>
                  <DetailRow icon={FileText} label="Notes" value={thread.prospect.notes} />
                  <DetailRow icon={MessageSquare} label="Feedback" value={thread.prospect.feedback} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
