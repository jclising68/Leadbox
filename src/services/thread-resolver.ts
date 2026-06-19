import { prisma } from "@/lib/prisma";
import { logActivity } from "@/services/lead-activity";
import type { NormalizedWebhookPayload } from "@/types";
import type { Prospect, Thread, Message } from "@prisma/client";

type ResolvedThread = {
  prospect: Prospect;
  thread: Thread;
  message: Message;
  isNewThread: boolean;
  isNewMessage: boolean;
};

export async function resolveThread(
  workspaceId: string,
  integrationId: string,
  payload: NormalizedWebhookPayload
): Promise<ResolvedThread> {
  // Require at least one prospect identifier
  if (!payload.prospectEmail && !payload.prospectLinkedinUrl) {
    throw new Error("Cannot resolve thread: prospect has no email or LinkedIn URL");
  }

  // Wrap the entire resolve flow in a transaction for atomicity.
  // Increase timeout from default 5s to 30s — Supabase PgBouncer can be slow.
  const result = await prisma.$transaction(async (tx) => {
    // 1. Find or create prospect
    const prospect = await findOrCreateProspect(tx, workspaceId, payload);

    // 2. Find or create thread for this prospect
    let thread = await tx.thread.findUnique({
      where: { prospectId: prospect.id },
    });

    const isNewThread = !thread;

    if (!thread) {
      try {
        // Campaign outbound threads start ARCHIVED — they surface in Archive until
        // the lead replies, at which point the first INBOUND message flips them OPEN.
        // Compose (no integrationId) and inbound-first threads start OPEN.
        const initialStatus =
          integrationId && payload.direction === "OUTBOUND" ? "ARCHIVED" : "OPEN";
        thread = await tx.thread.create({
          data: {
            workspaceId,
            prospectId: prospect.id,
            channel: payload.channel,
            status: initialStatus,
            isUnread: payload.direction === "INBOUND",
            lastMessageAt: payload.sentAt || new Date(),
          },
        });
      } catch (err: unknown) {
        // Handle race condition: thread was created by concurrent request
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
          thread = await tx.thread.findUnique({
            where: { prospectId: prospect.id },
          });
          if (!thread) throw err;
        } else {
          throw err;
        }
      }
    }

    // 3. If we've already seen this message, refresh its rawPayload (sync code
    // may have started persisting new fields like linkedInAccountId that older
    // rows don't have). Don't touch immutable fields like direction or sentAt.
    if (payload.externalId) {
      const existing = await tx.message.findUnique({
        where: {
          externalId_workspaceId: {
            externalId: payload.externalId,
            workspaceId,
          },
        },
      });
      if (existing) {
        const refreshed = await tx.message.update({
          where: { id: existing.id },
          data: {
            rawPayload: payload.rawPayload as object,
            campaignId: existing.campaignId ?? payload.campaignId,
            campaignName: existing.campaignName ?? payload.campaignName,
          },
        });
        return { prospect, thread, message: refreshed, isNewThread: false, isNewMessage: false };
      }
    }

    // 3b. Reconcile optimistic local rows. When a user replies from LeadBox,
    // `heyreach-reply.ts` / `instantly-reply.ts` insert an immediate row with a
    // fabricated externalId (`hr_reply_*` / `reply_*`) so the UI feels fast.
    // When the next sync pulls the provider's authoritative copy back, the
    // externalIds won't match — without reconciliation we'd end up with two
    // rows for the same outbound send. Match on thread+direction+body within
    // a short window and upgrade the optimistic row in place.
    if (
      payload.direction === "OUTBOUND" &&
      payload.externalId &&
      (payload.messageText || payload.bodyText)
    ) {
      const body = (payload.messageText || payload.bodyText || "").trim();
      if (body.length > 0) {
        const windowStart = new Date(
          (payload.sentAt?.getTime() || Date.now()) - 30 * 60 * 1000
        );
        const optimistic = await tx.message.findFirst({
          where: {
            threadId: thread.id,
            direction: "OUTBOUND",
            externalId: { startsWith: payload.channel === "LINKEDIN" ? "hr_reply_" : "reply_" },
            OR: [{ messageText: body }, { bodyText: body }],
            sentAt: { gte: windowStart },
          },
          orderBy: { sentAt: "desc" },
        });
        if (optimistic) {
          const reconciled = await tx.message.update({
            where: { id: optimistic.id },
            data: {
              externalId: payload.externalId,
              rawPayload: payload.rawPayload as object,
              campaignId: optimistic.campaignId ?? payload.campaignId,
              campaignName: optimistic.campaignName ?? payload.campaignName,
              sentAt: payload.sentAt ?? optimistic.sentAt,
            },
          });
          return { prospect, thread, message: reconciled, isNewThread: false, isNewMessage: false };
        }
      }
    }

    // 4. Create message
    const message = await tx.message.create({
      data: {
        workspaceId,
        threadId: thread.id,
        integrationId,
        direction: payload.direction,
        channel: payload.channel,
        fromEmail: payload.fromEmail,
        toEmail: payload.toEmail,
        subject: payload.subject,
        bodyText: payload.bodyText,
        bodyHtml: payload.bodyHtml,
        linkedinFrom: payload.channel === "LINKEDIN" ? payload.prospectLinkedinUrl : undefined,
        messageText: payload.messageText,
        externalId: payload.externalId,
        campaignId: payload.campaignId,
        campaignName: payload.campaignName,
        eventType: payload.eventType,
        rawPayload: payload.rawPayload as object,
        sentAt: payload.sentAt,
        receivedAt: payload.sentAt ?? new Date(),
      },
    });

    // 5. Update thread
    //    - snippet: set if currently empty (covers first message) OR if this
    //      message is newer than the last one we've seen on the thread
    //    - lastMessageAt: only bump forward, never backward
    //    This supports out-of-order processing without losing snippets on
    //    newly-created threads where thread.lastMessageAt == msgTime.
    const snippet =
      payload.bodyText?.slice(0, 200) ||
      payload.messageText?.slice(0, 200) ||
      payload.subject ||
      "";

    const msgTime = payload.sentAt || new Date();
    const snippetIsEmpty = !thread.snippet || thread.snippet.length === 0;
    const isNewerThanLast = !thread.lastMessageAt || msgTime > thread.lastMessageAt;
    const shouldUpdateSnippet = snippet.length > 0 && (snippetIsEmpty || isNewerThanLast);

    // Keep Thread.channel aligned with the most recent message's channel.
    // Without this, a HeyReach-first thread that later gets emails stays
    // channel=LINKEDIN forever (and vice versa), breaking the Email/LinkedIn
    // filter which reads Thread.channel. Only flip on messages that are newer
    // than the previously-seen latest, to avoid out-of-order sync runs
    // resurrecting an old channel.
    const shouldUpdateChannel =
      isNewerThanLast && payload.channel !== thread.channel;

    // First REAL inbound reply on an archived campaign thread → move to OPEN so
    // it surfaces in Inbox. Only flip on messages with actual body content to
    // avoid events like email_opened or CONNECTION_ACCEPTED (which arrive as
    // INBOUND but carry no text) from prematurely unarchiving a thread.
    const hasReplyContent = !!(payload.bodyText?.trim() || payload.messageText?.trim());
    const shouldUnarchive =
      payload.direction === "INBOUND" && thread.status === "ARCHIVED" && hasReplyContent;

    await tx.thread.update({
      where: { id: thread.id },
      data: {
        ...(shouldUpdateSnippet ? { snippet } : {}),
        ...(isNewerThanLast ? { lastMessageAt: msgTime } : {}),
        ...(shouldUpdateChannel ? { channel: payload.channel } : {}),
        ...(shouldUnarchive ? { status: "OPEN" } : {}),
        messageCount: { increment: 1 },
        isUnread: payload.direction === "INBOUND" ? true : undefined,
      },
    });

    return { prospect, thread, message, isNewThread, isNewMessage: true };
  }, { timeout: 30000 });

  // Fire AI reply draft generation for genuinely new INBOUND messages.
  // Non-blocking — runs in the background so it doesn't slow down sync or
  // webhook response time. Works for both webhook-triggered and sync-triggered
  // replies since all message creation flows through resolveThread.
  if (result.isNewMessage && result.message.direction === "INBOUND") {
    import("@/services/ai-reply-drafter")
      .then(({ generateReplyDraft }) => {
        generateReplyDraft(workspaceId, result.thread.id).catch((err) => {
          console.error("[thread-resolver] AI draft generation failed:", err instanceof Error ? err.message : err);
        });
      })
      .catch(() => {});

    // Log "lead replied" activity — only for messages with real content
    // (excludes connection-accepted / email-opened events that carry no body)
    const hasContent = !!(result.message.bodyText?.trim() || result.message.messageText?.trim());
    if (hasContent) {
      logActivity(workspaceId, result.thread.id, result.prospect.id, "reply_received", {
        channel: result.thread.channel,
      });
    }
  }

  return result;
}


type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function findOrCreateProspect(
  tx: TxClient,
  workspaceId: string,
  payload: NormalizedWebhookPayload
): Promise<Prospect> {
  // Try to find by email first
  if (payload.prospectEmail) {
    const existing = await tx.prospect.findUnique({
      where: {
        workspaceId_email: {
          workspaceId,
          email: payload.prospectEmail,
        },
      },
    });

    if (existing) {
      // Update with any new data — also link LinkedIn if we now have it
      return tx.prospect.update({
        where: { id: existing.id },
        data: {
          linkedinUrl: existing.linkedinUrl || payload.prospectLinkedinUrl || undefined,
          firstName: existing.firstName || payload.prospectFirstName || undefined,
          lastName: existing.lastName || payload.prospectLastName || undefined,
          company: existing.company || payload.prospectCompany || undefined,
        },
      });
    }
  }

  // Try to find by LinkedIn URL
  if (payload.prospectLinkedinUrl) {
    const existing = await tx.prospect.findUnique({
      where: {
        workspaceId_linkedinUrl: {
          workspaceId,
          linkedinUrl: payload.prospectLinkedinUrl,
        },
      },
    });

    if (existing) {
      return tx.prospect.update({
        where: { id: existing.id },
        data: {
          email: existing.email || payload.prospectEmail || undefined,
          firstName: existing.firstName || payload.prospectFirstName || undefined,
          lastName: existing.lastName || payload.prospectLastName || undefined,
          company: existing.company || payload.prospectCompany || undefined,
        },
      });
    }
  }

  // Create new prospect
  try {
    return await tx.prospect.create({
      data: {
        workspaceId,
        email: payload.prospectEmail,
        linkedinUrl: payload.prospectLinkedinUrl,
        firstName: payload.prospectFirstName,
        lastName: payload.prospectLastName,
        company: payload.prospectCompany,
        domain: payload.prospectEmail
          ? payload.prospectEmail.split("@")[1]
          : undefined,
      },
    });
  } catch (err: unknown) {
    // Handle race condition: prospect was created by concurrent request
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      if (payload.prospectEmail) {
        const existing = await tx.prospect.findUnique({
          where: { workspaceId_email: { workspaceId, email: payload.prospectEmail } },
        });
        if (existing) return existing;
      }
      if (payload.prospectLinkedinUrl) {
        const existing = await tx.prospect.findUnique({
          where: { workspaceId_linkedinUrl: { workspaceId, linkedinUrl: payload.prospectLinkedinUrl } },
        });
        if (existing) return existing;
      }
    }
    throw err;
  }
}
