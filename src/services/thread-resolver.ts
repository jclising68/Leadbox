import { prisma } from "@/lib/prisma";
import type { NormalizedWebhookPayload } from "@/types";
import type { Prospect, Thread, Message } from "@prisma/client";

type ResolvedThread = {
  prospect: Prospect;
  thread: Thread;
  message: Message;
  isNewThread: boolean;
};

export async function resolveThread(
  workspaceId: string,
  integrationId: string,
  payload: NormalizedWebhookPayload
): Promise<ResolvedThread> {
  // 1. Find or create prospect
  const prospect = await findOrCreateProspect(workspaceId, payload);

  // 2. Find or create thread for this prospect
  let thread = await prisma.thread.findUnique({
    where: { prospectId: prospect.id },
  });

  const isNewThread = !thread;

  if (!thread) {
    try {
      thread = await prisma.thread.create({
        data: {
          workspaceId,
          prospectId: prospect.id,
          channel: payload.channel,
          status: "OPEN",
          isUnread: payload.direction === "INBOUND",
          lastMessageAt: payload.sentAt || new Date(),
        },
      });
    } catch (err: unknown) {
      // Handle race condition: thread was created by concurrent request
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        thread = await prisma.thread.findUnique({
          where: { prospectId: prospect.id },
        });
        if (!thread) throw err;
      } else {
        throw err;
      }
    }
  }

  // 3. Check for duplicate message
  if (payload.externalId) {
    const existing = await prisma.message.findUnique({
      where: {
        externalId_workspaceId: {
          externalId: payload.externalId,
          workspaceId,
        },
      },
    });
    if (existing) {
      return { prospect, thread, message: existing, isNewThread: false };
    }
  }

  // 4. Create message
  const message = await prisma.message.create({
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
    },
  });

  // 5. Update thread
  const snippet =
    payload.bodyText?.slice(0, 200) ||
    payload.messageText?.slice(0, 200) ||
    payload.subject ||
    "";

  await prisma.thread.update({
    where: { id: thread.id },
    data: {
      snippet,
      lastMessageAt: payload.sentAt || new Date(),
      messageCount: { increment: 1 },
      isUnread: payload.direction === "INBOUND" ? true : undefined,
      channel: payload.channel,
    },
  });

  return { prospect, thread, message, isNewThread };
}

async function findOrCreateProspect(
  workspaceId: string,
  payload: NormalizedWebhookPayload
): Promise<Prospect> {
  // Try to find by email first
  if (payload.prospectEmail) {
    const existing = await prisma.prospect.findUnique({
      where: {
        workspaceId_email: {
          workspaceId,
          email: payload.prospectEmail,
        },
      },
    });

    if (existing) {
      // Update with any new data
      return prisma.prospect.update({
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
    const existing = await prisma.prospect.findUnique({
      where: {
        workspaceId_linkedinUrl: {
          workspaceId,
          linkedinUrl: payload.prospectLinkedinUrl,
        },
      },
    });

    if (existing) {
      return prisma.prospect.update({
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
    return await prisma.prospect.create({
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
        const existing = await prisma.prospect.findUnique({
          where: { workspaceId_email: { workspaceId, email: payload.prospectEmail } },
        });
        if (existing) return existing;
      }
      if (payload.prospectLinkedinUrl) {
        const existing = await prisma.prospect.findUnique({
          where: { workspaceId_linkedinUrl: { workspaceId, linkedinUrl: payload.prospectLinkedinUrl } },
        });
        if (existing) return existing;
      }
    }
    throw err;
  }
}
