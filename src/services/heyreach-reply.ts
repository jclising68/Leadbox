import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const HEYREACH_API_BASE = "https://api.heyreach.io/api/public";

async function heyreachPost(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${HEYREACH_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach API ${res.status}: ${text}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

export async function replyViaHeyreach(
  integrationId: string,
  threadId: string,
  messageText: string
): Promise<{ messageId: string }> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  // Get thread with prospect and last HeyReach message (for linkedInAccountId)
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { linkedinUrl: true, email: true } },
      messages: {
        where: {
          integrationId,
          rawPayload: { not: { equals: null } },
        },
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { rawPayload: true },
      },
    },
  });

  if (!thread.prospect.linkedinUrl) {
    throw new Error("Prospect has no LinkedIn URL");
  }

  // Extract linkedInAccountId from the last HeyReach message's raw payload
  const rawPayload = thread.messages[0]?.rawPayload as Record<string, unknown> | null;
  const linkedInAccountId =
    (rawPayload?.linkedInAccountId as number) ??
    (rawPayload?.linkedInAccount as Record<string, unknown>)?.id;

  if (!linkedInAccountId) {
    throw new Error(
      "Could not determine LinkedIn sender account. Try syncing first."
    );
  }

  // Send message via HeyReach API
  await heyreachPost(apiKey, "/Inbox/SendMessage", {
    linkedInAccountId,
    correspondentProfileUrl: thread.prospect.linkedinUrl,
    message: messageText,
  });

  // Create outbound message record
  const message = await prisma.message.create({
    data: {
      workspaceId: integration.workspaceId,
      threadId,
      integrationId,
      direction: "OUTBOUND",
      channel: "LINKEDIN",
      linkedinFrom: null, // Our sender
      linkedinTo: thread.prospect.linkedinUrl,
      messageText,
      bodyText: messageText,
      externalId: `hr_reply_${Date.now()}`,
      sentAt: new Date(),
      receivedAt: new Date(),
    },
  });

  // Update thread
  await prisma.thread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: new Date(),
      snippet: messageText.slice(0, 200),
      messageCount: { increment: 1 },
      isUnread: false,
    },
  });

  return { messageId: message.id };
}
