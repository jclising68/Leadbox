import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const MIN_REQUEST_GAP_MS = 3500;

let lastRequestTime = 0;

async function instantlyPost(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestTime = Date.now();

  const res = await fetch(`${INSTANTLY_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instantly API ${res.status}: ${text}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

export async function replyViaInstantly(
  integrationId: string,
  threadId: string,
  bodyHtml: string
): Promise<{ messageId: string }> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  // Find the last message in the thread to get the reply-to UUID
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true } },
      messages: {
        where: { externalId: { not: null } },
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { externalId: true },
      },
    },
  });

  const lastMessage = thread.messages[0];
  if (!lastMessage?.externalId) {
    throw new Error("No message with external ID found to reply to");
  }

  // Send reply via Instantly API
  const result = await instantlyPost(apiKey, "/emails/reply", {
    reply_to_uuid: lastMessage.externalId,
    body: bodyHtml,
  });

  const sentEmailId = (result.id as string) || `reply_${Date.now()}`;

  // Create outbound message record
  const message = await prisma.message.create({
    data: {
      workspaceId: integration.workspaceId,
      threadId,
      integrationId,
      direction: "OUTBOUND",
      channel: "EMAIL",
      fromEmail: null, // Will be the sending account email
      toEmail: thread.prospect.email,
      bodyHtml,
      bodyText: bodyHtml.replace(/<[^>]+>/g, "").trim(),
      externalId: sentEmailId,
      sentAt: new Date(),
      receivedAt: new Date(),
    },
  });

  // Update thread
  const snippet = bodyHtml
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 200);

  await prisma.thread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: new Date(),
      snippet,
      messageCount: { increment: 1 },
      isUnread: false,
    },
  });

  return { messageId: message.id };
}
