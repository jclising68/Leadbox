import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import type { NormalizedWebhookPayload } from "@/types";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const PAGE_SIZE = 100;
const MIN_REQUEST_GAP_MS = 1000; // 1 request/sec — safely under Instantly v2 rate limits

// Per-API-key rate limiter so parallel syncs of different workspaces don't
// throttle each other (each Instantly account has its own quota).
const lastRequestByKey = new Map<string, number>();

type InstantlyEmail = {
  id: string;
  timestamp_created: string;
  timestamp_email?: string;
  message_id?: string;
  subject?: string;
  to_address_email_list?: string;
  body?: { text?: string; html?: string };
  from_address_email?: string;
  cc_address_email_list?: string;
  campaign_id?: string;
  lead?: string;
  ue_type?: number; // 1=sent, 2=reply
  eaccount?: string;
  thread_id?: string;
  content_preview?: string;
  from_address_json?: { address: string; name: string }[];
  to_address_json?: { address: string; name: string }[];
};

async function pacePerKey(apiKey: string) {
  const last = lastRequestByKey.get(apiKey) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestByKey.set(apiKey, Date.now());
}

async function rateLimitedFetch(apiKey: string, path: string, params?: Record<string, string>, retries = 5): Promise<Record<string, unknown>> {
  const url = new URL(`${INSTANTLY_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    await pacePerKey(apiKey);

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 429) {
        const waitMs = Math.min(10000 * Math.pow(2, attempt), 120000);
        console.log(`[sync] Rate limited on ${path}, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`);
        await new Promise((r) => setTimeout(r, waitMs));
        lastRequestByKey.set(apiKey, Date.now());
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Instantly API ${res.status}: ${text}`);
      }

      return res.json() as Promise<Record<string, unknown>>;
    } catch (err) {
      if (attempt === retries) throw err;
      // Network error — retry
      const waitMs = 5000 * (attempt + 1);
      console.log(`[sync] Request error on ${path}, retrying in ${waitMs}ms:`, err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw new Error("Instantly API failed after retries");
}

async function fetchEmailsIncremental(
  apiKey: string,
  existingIds: Set<string>,
  timeBudgetMs: number,
  startTime: number,
): Promise<{ emails: InstantlyEmail[]; exhausted: boolean }> {
  const allEmails: InstantlyEmail[] = [];
  let cursor: string | undefined;
  let page = 0;
  let exhausted = true; // true = we fetched everything (no early exit)

  while (true) {
    // Time-budget check — leave room for processing
    if (Date.now() - startTime > timeBudgetMs * 0.5) {
      console.log(`[sync] Fetch phase hit 50% time budget after ${page} pages, proceeding to process`);
      exhausted = false;
      break;
    }

    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      sort_order: "desc", // Newest first — so we can stop early
    };
    if (cursor) params.starting_after = cursor;

    console.log(`[sync] Fetching emails page ${++page}${cursor ? ` (cursor: ${cursor.slice(0, 8)}...)` : ""}...`);
    const data = await rateLimitedFetch(apiKey, "/emails", params);
    const items = (data.items || []) as InstantlyEmail[];

    if (items.length === 0) break;
    allEmails.push(...items);

    // Early termination: if >80% of this page already synced, the rest
    // is old data we've seen before — stop fetching more pages.
    const newInPage = items.filter((e) => !existingIds.has(e.id)).length;
    const pctNew = newInPage / items.length;
    console.log(`[sync] Page ${page}: ${items.length} emails, ${newInPage} new (${Math.round(pctNew * 100)}%) — total fetched: ${allEmails.length}`);

    if (pctNew < 0.2 && page > 1) {
      console.log(`[sync] Early termination: page ${page} is mostly old data`);
      break;
    }

    cursor = data.next_starting_after as string | undefined;
    if (!cursor || items.length < PAGE_SIZE) break;
  }

  return { emails: allEmails, exhausted };
}

async function fetchCampaigns(apiKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    // Single request — most accounts have < 100 campaigns
    const data = await rateLimitedFetch(apiKey, "/campaigns", { limit: "100" });
    const items = (data.items || []) as { id: string; name: string }[];
    for (const c of items) map.set(c.id, c.name);
  } catch {
    console.log("[sync] Could not fetch campaigns, continuing without names");
  }

  return map;
}

function parseNameFromEmail(email: InstantlyEmail): { firstName?: string; lastName?: string } {
  if (email.ue_type === 2 && email.from_address_json?.[0]?.name) {
    const parts = email.from_address_json[0].name.trim().split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
  }
  if (email.ue_type === 1 && email.to_address_json?.[0]?.name) {
    const parts = email.to_address_json[0].name.trim().split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
  }
  return {};
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emailToPayload(
  email: InstantlyEmail,
  campaignMap: Map<string, string>
): NormalizedWebhookPayload {
  const isOutbound = email.ue_type === 1;
  const leadEmail = email.lead || (isOutbound ? email.to_address_email_list : email.from_address_email);
  const { firstName, lastName } = parseNameFromEmail(email);

  // Extract text from HTML if no text body
  let bodyText = email.body?.text;
  if (!bodyText && email.body?.html) {
    bodyText = stripHtmlToText(email.body.html);
  }

  return {
    provider: "INSTANTLY",
    eventType: isOutbound ? "email_sent" : "reply_received",
    direction: isOutbound ? "OUTBOUND" : "INBOUND",
    channel: "EMAIL",
    prospectEmail: leadEmail || undefined,
    prospectFirstName: firstName,
    prospectLastName: lastName,
    subject: email.subject,
    bodyText,
    bodyHtml: email.body?.html,
    fromEmail: email.from_address_email,
    toEmail: email.to_address_email_list,
    externalId: email.id,
    campaignId: email.campaign_id,
    campaignName: email.campaign_id ? campaignMap.get(email.campaign_id) : undefined,
    sentAt: email.timestamp_created ? new Date(email.timestamp_created) : undefined,
    rawPayload: email as unknown as Record<string, unknown>,
  };
}

export async function syncInstantly(
  integrationId: string,
  /** Total milliseconds this sync is allowed to run. Defaults to 250s
   *  (safe margin inside Vercel Pro's 300s limit). */
  timeBudgetMs = 250_000,
): Promise<{
  synced: number;
  skipped: number;
  errors: number;
}> {
  const startTime = Date.now();
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(integration.apiKeyEncrypted, integration.apiKeyIv, integration.apiKeyTag);
  const workspaceId = integration.workspaceId;

  console.log(`[sync] Starting Instantly sync for integration ${integrationId}`);

  const campaignMap = await fetchCampaigns(apiKey);
  console.log(`[sync] Found ${campaignMap.size} campaigns`);

  // Batch dedup — fetch existing externalIds from recent Instantly messages only.
  // Filter out HeyReach IDs (prefixed "hr_") so each provider scopes to its own,
  // and limit to last 90 days to avoid loading the entire table into memory.
  const dedupCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const existingIds = new Set(
    (await prisma.message.findMany({
      where: {
        workspaceId,
        externalId: { not: null },
        NOT: { externalId: { startsWith: "hr_" } },
        receivedAt: { gte: dedupCutoff },
      },
      select: { externalId: true },
    })).map((m) => m.externalId).filter(Boolean)
  );

  const { emails } = await fetchEmailsIncremental(
    apiKey, existingIds as Set<string>, timeBudgetMs, startTime,
  );
  console.log(`[sync] Fetched ${emails.length} emails from Instantly`);

  // Sort newest-first so the most recent data appears immediately.
  // The thread resolver handles out-of-order processing correctly
  // (only updates lastMessageAt/snippet if the message is newer).
  emails.sort((a, b) => {
    const da = new Date(a.timestamp_created || 0).getTime();
    const db = new Date(b.timestamp_created || 0).getTime();
    return db - da;
  });

  const newEmails = emails.filter((e) => !existingIds.has(e.id) && (e.lead || e.from_address_email || e.to_address_email_list));
  console.log(`[sync] ${emails.length - newEmails.length} already synced, ${newEmails.length} new emails to process`);

  let synced = 0;
  let skipped = emails.length - newEmails.length;
  let errors = 0;

  // Process only NEW emails sequentially to maintain thread ordering
  for (const email of newEmails) {
    // Time-budget check — stop processing if we're running out of time
    if (Date.now() - startTime > timeBudgetMs * 0.9) {
      console.log(`[sync] Time budget exhausted during processing, ${newEmails.length - synced - errors} emails deferred to next sync`);
      break;
    }

    try {
      const payload = emailToPayload(email, campaignMap);
      if (!payload.prospectEmail) {
        skipped++;
        continue;
      }
      await resolveThread(workspaceId, integrationId, payload);
      synced++;
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`[sync] Error processing email ${email.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await prisma.integration.update({
    where: { id: integrationId },
    data: { lastSyncAt: new Date() },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[sync] Instantly sync complete in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors`);
  return { synced, skipped, errors };
}

export async function testInstantlyConnection(apiKey: string): Promise<boolean> {
  try {
    const url = new URL(`${INSTANTLY_API_BASE}/campaigns`);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
