import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import type { NormalizedWebhookPayload } from "@/types";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const PAGE_SIZE = 100;
const MIN_REQUEST_GAP_MS = 1000; // 1 request/sec — safely under Instantly v2 rate limits

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

let lastRequestTime = 0;

async function rateLimitedFetch(apiKey: string, path: string, params?: Record<string, string>, retries = 5): Promise<Record<string, unknown>> {
  const url = new URL(`${INSTANTLY_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Ensure minimum gap between requests
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - timeSinceLast));
    }
    lastRequestTime = Date.now();

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
        lastRequestTime = Date.now();
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

async function fetchAllEmails(apiKey: string): Promise<InstantlyEmail[]> {
  const allEmails: InstantlyEmail[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    const params: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (cursor) params.starting_after = cursor;

    console.log(`[sync] Fetching emails page ${++page}${cursor ? ` (cursor: ${cursor.slice(0, 8)}...)` : ""}...`);
    const data = await rateLimitedFetch(apiKey, "/emails", params);
    const items = (data.items || []) as InstantlyEmail[];

    if (items.length === 0) break;
    allEmails.push(...items);
    console.log(`[sync] Page ${page}: got ${items.length} emails (total: ${allEmails.length})`);

    cursor = data.next_starting_after as string | undefined;
    if (!cursor || items.length < PAGE_SIZE) break;
  }

  return allEmails;
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

export async function syncInstantly(integrationId: string): Promise<{
  synced: number;
  skipped: number;
  errors: number;
}> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(integration.apiKeyEncrypted, integration.apiKeyIv, integration.apiKeyTag);
  const workspaceId = integration.workspaceId;

  console.log(`[sync] Starting Instantly sync for integration ${integrationId}`);

  const campaignMap = await fetchCampaigns(apiKey);
  console.log(`[sync] Found ${campaignMap.size} campaigns`);

  const emails = await fetchAllEmails(apiKey);
  console.log(`[sync] Fetched ${emails.length} emails from Instantly`);

  // Sort chronologically so threads build in order
  emails.sort((a, b) => {
    const da = new Date(a.timestamp_created || 0).getTime();
    const db = new Date(b.timestamp_created || 0).getTime();
    return da - db;
  });

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // Process sequentially to maintain thread ordering and avoid race conditions
  for (const email of emails) {
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

  console.log(`[sync] Instantly sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);
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
