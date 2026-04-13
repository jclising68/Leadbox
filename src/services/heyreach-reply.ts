import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const HEYREACH_API_BASE = "https://api.heyreach.io/api/public";

/**
 * Deterministic outbound externalId: same (thread, body, 30-second bucket)
 * always produces the same value. Combined with the
 * @@unique([externalId, workspaceId]) index on Message, this lets the DB
 * itself catch parallel double-sends — critical on Vercel where two lambda
 * instances may race before either row is written, bypassing the pre-check.
 * On P2002 we return the already-written row.
 */
function computeReplyExternalId(
  prefix: "hr_reply" | "reply",
  threadId: string,
  body: string
): string {
  const bucket = Math.floor(Date.now() / 30_000);
  const hash = createHash("sha1")
    .update(`${threadId}|${body}|${bucket}`)
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${threadId}_${hash}`;
}

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

  // Read as text first — HeyReach endpoints like /Inbox/SendMessage return
  // 200 OK with an empty body on success. Calling res.json() on that throws
  // "Unexpected end of JSON input" and makes a successful send look failed.
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HeyReach API ${res.status}: ${text}`);
  }

  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Non-JSON 2xx body — treat as success, return empty object.
    return {};
  }
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

  // Get thread with prospect and ALL HeyReach messages — we scan in reverse
  // chronological order looking for the first one whose rawPayload tells us
  // which LinkedIn account sent it.
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
        select: { rawPayload: true },
      },
    },
  });

  if (!thread.prospect.linkedinUrl) {
    throw new Error("Prospect has no LinkedIn URL");
  }

  // Idempotency: reject rapid duplicate sends (double-click, network retry,
  // refresh-then-resend). If the identical body went out from LeadBox to this
  // thread in the last 30 seconds, treat the new request as a no-op instead
  // of pushing a second copy to HeyReach. This keeps HeyReach clean — we can
  // reconcile optimistic rows on our side, but we can't unsend on theirs.
  const trimmed = messageText.trim();
  if (trimmed) {
    const since = new Date(Date.now() - 30 * 1000);
    const recentDup = await prisma.message.findFirst({
      where: {
        threadId,
        direction: "OUTBOUND",
        messageText: trimmed,
        sentAt: { gte: since },
      },
      select: { id: true },
    });
    if (recentDup) {
      console.warn(
        `[heyreach-reply] skipping duplicate send — same body already sent to thread ${threadId} in last 30s`
      );
      return { messageId: recentDup.id };
    }
  }

  // Walk thread messages newest-first to extract both the conversationId AND
  // linkedInAccountId from rawPayload. HeyReach's SendMessage endpoint
  // identifies the chat by conversationId — *not* by profile URL — so without
  // it the API returns "This conversation does not exist".
  let linkedInAccountId: number | undefined;
  let conversationId: string | undefined;
  for (const m of thread.messages) {
    const raw = m.rawPayload as Record<string, unknown> | null;
    if (!raw) continue;
    if (typeof raw.conversationId === "string" && !conversationId) {
      conversationId = raw.conversationId;
    }
    if (linkedInAccountId === undefined) {
      const id =
        (raw.linkedInAccountId as number | undefined) ??
        (raw.linkedInAccount as Record<string, unknown> | undefined)?.id;
      if (typeof id === "number") linkedInAccountId = id;
    }
    if (conversationId && linkedInAccountId !== undefined) break;
  }

  if (!conversationId) {
    throw new Error(
      "Could not determine the HeyReach conversation ID for this thread. Click the inbox refresh icon to re-sync, then try replying again."
    );
  }

  // Fallback: messages synced before we started persisting linkedInAccountId
  // won't have it. Ask HeyReach which accounts exist; if there is exactly one
  // *active* account, use it. Otherwise we genuinely can't infer the sender.
  if (!linkedInAccountId) {
    const accountsRes = await fetch(
      "https://api.heyreach.io/api/public/LinkedInAccount/GetAll?offset=0&limit=100",
      { headers: { "X-API-KEY": apiKey } }
    );
    if (accountsRes.ok) {
      const data = (await accountsRes.json()) as {
        items?: { id: number; isActive?: boolean }[];
      };
      const active = (data.items ?? []).filter((a) => a.isActive);
      if (active.length === 1) linkedInAccountId = active[0].id;
    }
  }

  if (!linkedInAccountId) {
    throw new Error(
      "Could not determine which LinkedIn account this conversation belongs to. Click the refresh icon in the inbox header to re-sync — that pulls in the sender account info — then try replying again."
    );
  }

  // Pre-flight: confirm the account is in a state HeyReach will let us send
  // from. Cheaper to fail with a clear message than to hit SendMessage and
  // translate an opaque error.
  const accountsRes = await fetch(
    "https://api.heyreach.io/api/public/LinkedInAccount/GetAll?offset=0&limit=100",
    { headers: { "X-API-KEY": apiKey } }
  );
  if (accountsRes.ok) {
    const data = (await accountsRes.json()) as {
      items?: {
        id: number;
        firstName?: string;
        lastName?: string;
        emailAddress?: string;
        isActive?: boolean;
        authIsValid?: boolean;
      }[];
    };
    const account = (data.items ?? []).find((a) => a.id === linkedInAccountId);
    if (account) {
      const fullName = `${account.firstName ?? ""} ${account.lastName ?? ""}`.trim() || account.emailAddress || `account ${linkedInAccountId}`;
      if (account.authIsValid === false) {
        throw new Error(
          `The LinkedIn account "${fullName}" needs to be re-authenticated in HeyReach before it can send messages.`
        );
      }
      if (account.isActive === false) {
        throw new Error(
          `The LinkedIn account "${fullName}" is inactive on HeyReach (no available seat in your subscription). Activate it in HeyReach → LinkedIn Accounts, or purchase additional seats.`
        );
      }
    }
  }

  // Send message via HeyReach API. Translate common error shapes into
  // user-friendly messages so the toast tells the user what's wrong.
  // SendMessage requires: conversationId, linkedInAccountId, message, subject.
  // LinkedIn DMs don't really have subjects, but the API requires the field —
  // pass an empty string.
  const sendBody = {
    conversationId,
    linkedInAccountId,
    message: messageText,
    subject: "",
  };
  console.log(
    "[heyreach-reply] POST /Inbox/SendMessage keys:",
    Object.keys(sendBody),
    "conversationId:",
    conversationId,
    "linkedInAccountId:",
    linkedInAccountId
  );
  try {
    await heyreachPost(apiKey, "/Inbox/SendMessage", sendBody);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    if (lower.includes("not active") || lower.includes("inactive") || lower.includes("no seat") || lower.includes("subscription")) {
      throw new Error("HeyReach: this LinkedIn account doesn't have an active subscription seat. Buy/assign a seat in HeyReach.");
    }
    if (lower.includes("not connected") || lower.includes("not in your network")) {
      throw new Error("HeyReach: you're not connected to this lead on LinkedIn — accept/send a connection request first.");
    }
    if (lower.includes("rate limit") || raw.includes(" 429")) {
      throw new Error("HeyReach rate limit hit — wait a minute and retry.");
    }
    throw err;
  }

  // Deterministic externalId for serverless-safe idempotency. If two lambdas
  // race past the 30s pre-check above, they'll both try to insert the same
  // externalId and the unique constraint will reject the second — we catch
  // P2002 and return the winning row.
  const deterministicExternalId = computeReplyExternalId(
    "hr_reply",
    threadId,
    messageText.trim()
  );

  let message;
  try {
    message = await prisma.message.create({
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
        `[heyreach-reply] lost race for ${deterministicExternalId}, returning winning row ${winner.id}`
      );
      return { messageId: winner.id };
    }
    throw err;
  }

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
