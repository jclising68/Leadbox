"use client";

import { useThread, useUpdateThread, useAddLabel, useRemoveLabel, useSendReply, useSetFollowUp, type ReplyAttachment } from "@/hooks/use-threads";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label as UiLabel } from "@/components/ui/label";
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
  MailOpen,
  Globe,
  Briefcase,
  Zap,
  Copy,
  Phone,
  FileText,
  MessageSquare,
  Send,
  Paperclip,
  CalendarClock,
  Milestone,
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
  const setFollowUp = useSetFollowUp();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const [replyText, setReplyText] = useState("");
  const [draftApplied, setDraftApplied] = useState(false);
  const [attachments, setAttachments] = useState<ReplyAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState("");
  const [pipelineStageId, setPipelineStageId] = useState("");
  const [pipelineTitle, setPipelineTitle] = useState("");
  const [pipelineNotes, setPipelineNotes] = useState("");
  const [pipelineValue, setPipelineValue] = useState("");
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [followUpDrafting, setFollowUpDrafting] = useState(false);
  const [redrafting, setRedrafting] = useState(false);
  const [draftDismissed, setDraftDismissed] = useState(false);

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

  // Pipelines for the "Add to Pipeline" dialog
  type PipelineStageShape = { id: string; name: string; color: string; sortOrder: number };
  type PipelineShape = { id: string; name: string; stages: PipelineStageShape[] };
  const { data: pipelines = [] } = useQuery<PipelineShape[]>({
    queryKey: ["pipelines", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await fetch("/api/pipeline", {
        headers: { "x-workspace-id": workspaceId },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
    staleTime: 30000,
  });

  // Pre-fill composer when a READY draft arrives and user hasn't typed anything
  useEffect(() => {
    if (aiDraft?.status === "READY" && !draftApplied && !replyText && !draftDismissed) {
      setReplyText(aiDraft.body);
      setDraftApplied(true);
    }
  }, [aiDraft?.status, aiDraft?.body, draftApplied, replyText, draftDismissed]);

  // Clear reply draft when switching threads
  useEffect(() => {
    setReplyText("");
    setDraftApplied(false);
    setDraftDismissed(false);
    setAttachments([]);
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

  async function handleAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !workspaceId) return;
    e.target.value = "";
    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("threadId", selectedThreadId ?? "");
      const res = await fetch("/api/attachments", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: form,
      });
      const json = await res.json() as { url?: string; name?: string; type?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setAttachments((prev) => [
        ...prev,
        { name: json.name!, url: json.url!, type: json.type! },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingFile(false);
    }
  }

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
              <MailOpen className="h-3.5 w-3.5" />
            </Button>

            {/* Follow-up date picker */}
            <Popover open={followUpOpen} onOpenChange={(o) => {
              setFollowUpOpen(o);
              if (o && thread.followUpAt) {
                // Pre-fill with existing follow-up date in local datetime-local format
                const d = new Date(thread.followUpAt);
                const pad = (n: number) => String(n).padStart(2, "0");
                setFollowUpDate(
                  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                );
              } else if (o) {
                setFollowUpDate("");
              }
            }}>
              <PopoverTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors",
                  thread.followUpAt ? "text-amber-500" : "text-muted-foreground"
                )}
                title={thread.followUpAt
                  ? `Follow-up set: ${new Date(thread.followUpAt).toLocaleDateString()}`
                  : "Set follow-up reminder"}
              >
                <CalendarClock className="h-3.5 w-3.5" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4">
                <p className="text-sm font-medium mb-3">Set follow-up reminder</p>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!followUpDate || setFollowUp.isPending}
                    onClick={() => {
                      setFollowUp.mutate(
                        { threadId: thread.id, followUpAt: new Date(followUpDate).toISOString() },
                        {
                          onSuccess: () => {
                            toast.success("Follow-up reminder set");
                            setFollowUpOpen(false);
                          },
                          onError: () => toast.error("Failed to set follow-up"),
                        }
                      );
                    }}
                  >
                    {setFollowUp.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  {thread.followUpAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={setFollowUp.isPending}
                      onClick={() => {
                        setFollowUp.mutate(
                          { threadId: thread.id, followUpAt: null },
                          {
                            onSuccess: () => {
                              toast.success("Follow-up cleared");
                              setFollowUpOpen(false);
                            },
                            onError: () => toast.error("Failed to clear follow-up"),
                          }
                        );
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

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
              <>
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
                <Button
                  variant="ghost" size="sm"
                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Permanently delete this contact and all messages"
                  onClick={async () => {
                    if (!confirm("Permanently delete this contact and all their messages? This cannot be undone.")) return;
                    try {
                      const res = await fetch(`/api/threads/${thread.id}`, {
                        method: "DELETE",
                        headers: workspaceId ? { "x-workspace-id": workspaceId } : {},
                      });
                      if (!res.ok) throw new Error("Failed");
                      toast.success("Permanently deleted");
                      setSelectedThread(null);
                      queryClient.invalidateQueries({ queryKey: ["threads"] });
                      queryClient.invalidateQueries({ queryKey: ["prospects"] });
                    } catch {
                      toast.error("Failed to delete");
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete permanently
                </Button>
              </>
            )}

            {/* Add to Pipeline */}
            <button
              title="Add to pipeline"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                const name = prospectName
                  ? prospectName
                  : thread.prospect.email ?? "Deal";
                setPipelineTitle(name);
                setPipelineNotes("");
                setPipelineValue("");
                const firstPipeline = pipelines[0];
                setPipelineId(firstPipeline?.id ?? "");
                setPipelineStageId(firstPipeline?.stages[0]?.id ?? "");
                setPipelineOpen(true);
              }}
            >
              <Milestone className="h-3.5 w-3.5" />
            </button>

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
                rawPayload: Record<string, unknown> | null;
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

                  {/* Bubble */}
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

                    {/* Attachments */}
                    {(() => {
                      const raw = msg.rawPayload as { attachments?: Array<{ name: string; url: string; type: string }> } | null;
                      const atts = raw?.attachments;
                      if (!atts?.length) return null;
                      return (
                        <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap gap-1.5">
                          {atts.map((a, i) => (
                            <a
                              key={i}
                              href={a.url.startsWith("/") ? a.url : a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white/15 hover:bg-white/25 transition-colors max-w-[200px]"
                            >
                              <Paperclip className="h-3 w-3 shrink-0" />
                              <span className="truncate">{a.name}</span>
                            </a>
                          ))}
                        </div>
                      );
                    })()}
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
          {/* Hidden file input */}
          <input
            ref={attachFileRef}
            type="file"
            className="hidden"
            onChange={handleAttachFile}
          />

          {/* AI Draft badge row */}
          {aiDraft?.status === "PENDING" && (
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating AI Draft…
            </div>
          )}
          {(aiDraft?.status === "READY" || aiDraft?.status === "DISCARDED") && (
            <div className="flex items-center gap-1.5 mb-2">
              {aiDraft.status === "READY" && draftApplied && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-1 ring-inset ring-violet-500/25">
                  <Sparkles className="h-2.5 w-2.5" />
                  AI Draft
                </span>
              )}
              <button
                type="button"
                disabled={redrafting}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                onClick={async () => {
                  if (!workspaceId || !selectedThreadId) return;
                  setRedrafting(true);
                  setReplyText("");
                  setDraftApplied(false);
                  setDraftDismissed(false);
                  try {
                    await fetch(`/api/threads/${selectedThreadId}/draft`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
                      body: JSON.stringify({}),
                    });
                    queryClient.invalidateQueries({ queryKey: ["ai-draft", selectedThreadId] });
                  } finally {
                    setRedrafting(false);
                  }
                }}
              >
                {redrafting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
                Redraft
              </button>
              {aiDraft.status === "READY" && draftApplied && (
                <>
                  <span className="text-muted-foreground/40 text-xs">·</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      setReplyText("");
                      setDraftApplied(false);
                      setDraftDismissed(true);
                    }}
                  >
                    Discard
                  </button>
                </>
              )}
            </div>
          )}

          {/* Follow Up draft button — shown when thread has a follow-up date set */}
          {thread?.followUpAt && (
            <div className="flex items-center gap-1.5 mb-2">
              <button
                type="button"
                disabled={followUpDrafting || aiDraft?.status === "PENDING"}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  if (!workspaceId || !selectedThreadId) return;
                  setFollowUpDrafting(true);
                  setReplyText("");
                  setDraftApplied(false);
                  try {
                    const res = await fetch(`/api/threads/${selectedThreadId}/draft`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "x-workspace-id": workspaceId,
                      },
                      body: JSON.stringify({ intent: "follow_up" }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      toast.error(err.error || "Failed to generate follow-up draft");
                      return;
                    }
                    queryClient.invalidateQueries({ queryKey: ["ai-draft", selectedThreadId] });
                  } finally {
                    setFollowUpDrafting(false);
                  }
                }}
              >
                {followUpDrafting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CalendarClock className="h-2.5 w-2.5" />}
                Draft Follow Up
              </button>
            </div>
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted border border-border max-w-[200px]"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive ml-0.5"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
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
                  { threadId: selectedThreadId!, body: replyText.trim(), attachments },
                  {
                    onSuccess: () => {
                      setReplyText("");
                      setDraftApplied(false);
                      setAttachments([]);
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
            <div className="flex items-center gap-2">
              {thread?.channel === "EMAIL" && (
                <button
                  type="button"
                  title="Attach file"
                  disabled={uploadingFile || sendReply.isPending}
                  onClick={() => attachFileRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  {uploadingFile ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {thread?.channel === "LINKEDIN" ? "LinkedIn message" : "Email reply"} · Cmd+Enter to send
              </span>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!replyText.trim() || sendReply.isPending}
              onClick={() => {
                sendReply.mutate(
                  { threadId: selectedThreadId!, body: replyText.trim(), attachments },
                  {
                    onSuccess: () => {
                      setReplyText("");
                      setDraftApplied(false);
                      setAttachments([]);
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

      {/* Add to Pipeline Dialog */}
      <Dialog open={pipelineOpen} onOpenChange={(o) => !o && setPipelineOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <UiLabel className="text-xs mb-1.5 block">Title *</UiLabel>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                value={pipelineTitle}
                onChange={(e) => setPipelineTitle(e.target.value)}
                placeholder="Deal title"
                autoFocus
              />
            </div>
            {pipelines.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No pipelines yet. Create one from the Pipeline page first.
              </p>
            ) : (
              <>
                <div>
                  <UiLabel className="text-xs mb-1.5 block">Pipeline</UiLabel>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                    value={pipelineId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setPipelineId(pid);
                      const pl = pipelines.find((p) => p.id === pid);
                      setPipelineStageId(pl?.stages[0]?.id ?? "");
                    }}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <UiLabel className="text-xs mb-1.5 block">Stage</UiLabel>
                  {(() => {
                    const activePipeline = pipelines.find((p) => p.id === pipelineId);
                    const stages = activePipeline?.stages ?? [];
                    return stages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No stages in this pipeline.</p>
                    ) : (
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                        value={pipelineStageId}
                        onChange={(e) => setPipelineStageId(e.target.value)}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              </>
            )}
            <div>
              <UiLabel className="text-xs mb-1.5 block">Value (USD)</UiLabel>
              <input
                type="number"
                min={0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                value={pipelineValue}
                onChange={(e) => setPipelineValue(e.target.value)}
                placeholder="e.g. 5000"
              />
            </div>
            <div>
              <UiLabel className="text-xs mb-1.5 block">Notes</UiLabel>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
                value={pipelineNotes}
                onChange={(e) => setPipelineNotes(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={() => setPipelineOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!pipelineTitle.trim() || !pipelineId || !pipelineStageId || pipelineSaving}
                onClick={async () => {
                  if (!workspaceId) return;
                  setPipelineSaving(true);
                  try {
                    const res = await fetch("/api/pipeline/deals", {
                      method: "POST",
                      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        pipelineId,
                        stageId: pipelineStageId,
                        title: pipelineTitle.trim(),
                        notes: pipelineNotes || null,
                        value: pipelineValue ? parseFloat(pipelineValue) : null,
                        prospectId: thread.prospect.id,
                        threadId: thread.id,
                      }),
                    });
                    if (!res.ok) throw new Error("Failed to add to pipeline");
                    toast.success("Added to pipeline");
                    setPipelineOpen(false);
                    queryClient.invalidateQueries({ queryKey: ["pipeline-deals"] });
                  } catch {
                    toast.error("Failed to add to pipeline");
                  } finally {
                    setPipelineSaving(false);
                  }
                }}
              >
                {pipelineSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add to pipeline"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

            {/* Pipeline */}
            {((thread.prospect as { pipelineDeals?: { id: string; pipeline: { name: string }; stage: { name: string; color: string } }[] }).pipelineDeals?.length ?? 0) > 0 && (
              <>
                <Separator className="my-3" />
                <div className="space-y-2.5">
                  <h5 className="text-xs font-semibold uppercase text-muted-foreground">Pipeline</h5>
                  {(thread.prospect as { pipelineDeals: { id: string; pipeline: { name: string }; stage: { name: string; color: string } }[] }).pipelineDeals.map((deal) => (
                    <div key={deal.id} className="flex items-center gap-2">
                      <Milestone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{deal.pipeline.name}</p>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: deal.stage.color }}
                          />
                          <p className="text-sm truncate">{deal.stage.name}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
