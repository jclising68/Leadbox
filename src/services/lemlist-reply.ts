import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";

function computeReplyExternalId(threadId: string, body: string): string {
  const bucket = Math.floor(Date.now() / 30_000);
  const hash = createHash("sha1")
    .update(`${threadId}|${body}|${bucket}`)
    .digest("hex")
    .slice(0, 16);
  return `lm_reply_${threadId}_${hash}`;
}

async function lemlistMcpSendMessage(
  apiKey: string,
  args: {
    sendUserId: string;
    contactId: string;
    sendUserEmail: string;
    sendUserMailboxId: string;
    subject: string;
    message: string;
  }
): Promise<void> {
  const res = await fetch(LEMLIST_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "send_message",
        arguments: {
          channel: "email",
          ...args,
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Lemlist MCP ${res.status}: ${text}`);
  }

  // Check for JSON-RPC error
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; result?: unknown };
    if (data.error) {
      throw new Error(`Lemlist send_message error: ${data.error.message ?? JSON.stringify(data.error)}`);
    }
  } catch (parseErr) {
    if (parseErr instanceof SyntaxError) {
      // Non-JSON 2xx body — treat as success
    } else {
      throw parseErr;
    }
  }
}

export async function replyViaLemlist(
  integrationId: string,
  threadId: string,
  body: string
): Promise<{ messageId: string }> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true } },
      messages: {
        where: {
          integrationId,
          rawPayload: { not: { equals: null } },
        },
        orderBy: { sentAt: "desc" },
        take: 25,
        select: {
          rawPayload: true,
          subject: true,
          direction: true,
          fromEmail: true,
          toEmail: true,
        },
      },
    },
  });

  // Idempotency: skip duplicate sends within 30s
  const trimmed = body.trim();
  if (trimmed) {
    const since = new Date(Date.now() - 30 * 1000);
    const recentDup = await prisma.message.findFirst({
      where: {
        threadId,
        direction: "OUTBOUND",
        bodyText: trimmed,
        sentAt: { gte: since },
      },
      select: { id: true },
    });
    if (recentDup) {
      console.warn(
        `[lemlist-reply] skipping duplicate send — same body already sent to thread ${threadId} in last 30s`
      );
      return { messageId: recentDup.id };
    }
  }

  // Extract sendUserId, sendUserEmail, sendUserMailboxId, contactId from rawPayload
  let sendUserId: string | undefined;
  let sendUserEmail: string | undefined;
  let sendUserMailboxId: string | undefined;
  let contactId: string | undefined;
  let subject = "Re:";

  for (const m of thread.messages) {
    const raw = m.rawPayload as Record<string, unknown> | null;
    if (!raw) continue;

    if (!sendUserId && typeof raw.sendUserId === "string") sendUserId = raw.sendUserId;
    if (!sendUserEmail && typeof raw.sendUserEmail === "string") sendUserEmail = raw.sendUserEmail;
    if (!sendUserMailboxId && typeof raw.sendUserMailboxId === "string")
      sendUserMailboxId = raw.sendUserMailboxId;
    if (!contactId && typeof raw.contactId === "string") contactId = raw.contactId;

    const s = m.subject?.trim();
    if (s && subject === "Re:") {
      subject = /^re:\s/i.test(s) ? s : `Re: ${s}`;
    }

    if (sendUserId && sendUserEmail && sendUserMailboxId && contactId) break;
  }

  if (!sendUserId || !contactId || !sendUserEmail || !sendUserMailboxId) {
    throw new Error(
      "Could not determine the Lemlist sender account for this thread. Click the inbox refresh icon to re-sync, then try again."
    );
  }

  // Send via Lemlist MCP
  await lemlistMcpSendMessage(apiKey, {
    sendUserId,
    contactId,
    sendUserEmail,
    sendUserMailboxId,
    subject,
    message: body,
  });

  const deterministicExternalId = computeReplyExternalId(threadId, trimmed);

  let message;
  try {
    message = await prisma.message.create({
      data: {
        workspaceId: integration.workspaceId,
        threadId,
        integrationId,
        direction: "OUTBOUND",
        channel: "EMAIL",
        fromEmail: sendUserEmail,
        toEmail: thread.prospect.email,
        bodyText: body.replace(/<[^>]+>/g, "").trim(),
        bodyHtml: body,
        externalId: deterministicExternalId,
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const winner = await prisma.message.findUniqueOrThrow({
        where: {
          externalId_workspaceId: {
            externalId: deterministicExternalId,
            workspaceId: integration.workspaceId,
          },
        },
      });
      console.warn(
        `[lemlist-reply] lost race for ${deterministicExternalId}, returning winning row ${winner.id}`
      );
      return { messageId: winner.id };
    }
    throw err;
  }

  const snippet = body
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
