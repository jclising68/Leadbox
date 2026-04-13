import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

/**
 * Deterministic outbound externalId: same (thread, body, 30-second bucket)
 * always produces the same value. Combined with the
 * @@unique([externalId, workspaceId]) index on Message, this lets the DB
 * itself catch parallel double-sends — critical on Vercel where two lambda
 * instances may race before either row is written, bypassing the pre-check.
 * On P2002 we return the already-written row.
 */
function computeReplyExternalId(threadId: string, body: string): string {
  const bucket = Math.floor(Date.now() / 30_000);
  const hash = createHash("sha1")
    .update(`${threadId}|${body}|${bucket}`)
    .digest("hex")
    .slice(0, 16);
  return `reply_${threadId}_${hash}`;
}

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

  // Read once as text — Instantly can return a 2xx with empty body on some
  // write endpoints. Calling res.json() on that throws
  // "Unexpected end of JSON input" and falsely looks like a failure.
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Instantly API ${res.status}: ${text}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
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

  // Pull recent messages so we can find both the reply-to UUID *and* the
  // eaccount (our sending email account). Instantly's `/emails/reply` requires
  // both — eaccount is whichever of our connected mailboxes participated in
  // this thread.
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true } },
      messages: {
        where: { externalId: { not: null } },
        orderBy: { sentAt: "desc" },
        take: 25,
        select: { externalId: true, direction: true, fromEmail: true, toEmail: true, subject: true, rawPayload: true },
      },
    },
  });

  const lastMessage = thread.messages[0];
  if (!lastMessage?.externalId) {
    throw new Error("No message with external ID found to reply to");
  }

  // Idempotency: reject rapid duplicate sends (double-click, network retry).
  // If the identical body went out from LeadBox to this thread in the last
  // 30 seconds, treat this as a no-op instead of pushing a second copy to
  // Instantly. We can dedupe our own rows later via sync reconciliation, but
  // we can't unsend a real email.
  const trimmed = bodyHtml.trim();
  if (trimmed) {
    const since = new Date(Date.now() - 30 * 1000);
    const recentDup = await prisma.message.findFirst({
      where: {
        threadId,
        direction: "OUTBOUND",
        bodyHtml: trimmed,
        sentAt: { gte: since },
      },
      select: { id: true },
    });
    if (recentDup) {
      console.warn(
        `[instantly-reply] skipping duplicate send — same body already sent to thread ${threadId} in last 30s`
      );
      return { messageId: recentDup.id };
    }
  }

  // Subject for the reply: walk recent messages for the first non-empty
  // subject and prepend "Re:" if it isn't already there. Falls back to a
  // generic subject if none found.
  let subject = "";
  for (const m of thread.messages) {
    const s = m.subject?.trim();
    if (s) {
      subject = /^re:\s/i.test(s) ? s : `Re: ${s}`;
      break;
    }
  }
  if (!subject) subject = "Re:";

  // Find our sending account (eaccount). Outbound messages: fromEmail is ours.
  // Inbound messages: toEmail is ours (the prospect emailed us). Walk newest
  // first so we use whatever account was used most recently.
  const prospectEmail = thread.prospect.email?.toLowerCase();
  let eaccount: string | undefined;
  for (const m of thread.messages) {
    const candidate =
      m.direction === "OUTBOUND"
        ? m.fromEmail
        : m.toEmail;
    // Defensive: never use the prospect's own email as our sending account.
    if (candidate && candidate.toLowerCase() !== prospectEmail) {
      eaccount = candidate;
      break;
    }
    // Some payloads only have it nested in raw fields.
    const raw = m.rawPayload as Record<string, unknown> | null;
    if (raw) {
      const fromRaw =
        m.direction === "OUTBOUND"
          ? (raw.from_address_email as string | undefined)
          : (raw.to_address_email_list as string | undefined);
      if (fromRaw && fromRaw.toLowerCase() !== prospectEmail) {
        eaccount = fromRaw.split(",")[0].trim();
        break;
      }
    }
  }

  if (!eaccount) {
    throw new Error(
      "Could not determine the Instantly sending account for this thread. Click the inbox refresh icon to re-sync, then try again."
    );
  }

  // Send reply via Instantly API
  const requestBody = {
    reply_to_uuid: lastMessage.externalId,
    eaccount,
    subject,
    body: { html: bodyHtml },
  };
  console.log(
    "[instantly-reply] POST /emails/reply body keys:",
    Object.keys(requestBody),
    "subject:",
    JSON.stringify(subject),
    "eaccount:",
    eaccount
  );
  const result = await instantlyPost(apiKey, "/emails/reply", requestBody);

  // Prefer Instantly's own id if it returned one — that way sync won't need
  // to reconcile at all. Fall back to our deterministic id so parallel
  // lambdas on Vercel can't bypass the 30-s pre-check and write duplicates.
  const returnedId = typeof result.id === "string" ? result.id : null;
  const deterministicExternalId =
    returnedId ?? computeReplyExternalId(threadId, bodyHtml.trim());

  let message;
  try {
    message = await prisma.message.create({
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
        `[instantly-reply] lost race for ${deterministicExternalId}, returning winning row ${winner.id}`
      );
      return { messageId: winner.id };
    }
    throw err;
  }

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
