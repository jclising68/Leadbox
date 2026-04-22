import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import { updateSyncProgress } from "@/services/sync-progress";
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

type FetchOutcome = "reached_end" | "early_terminated" | "time_budget";

async function fetchEmailsIncremental(
  integrationId: string,
  apiKey: string,
  existingIds: Set<string>,
  timeBudgetMs: number,
  startTime: number,
  /** If set, resume a multi-run backfill from this cursor instead of newest. */
  resumeCursor: string | undefined,
  /** Gate the "page is mostly old, stop" heuristic. Only safe once we've
   *  walked the full history at least once — otherwise it causes historical
   *  emails to never be paginated to because recent pages are already-synced. */
  allowEarlyTermination: boolean,
): Promise<{ emails: InstantlyEmail[]; outcome: FetchOutcome; nextCursor?: string }> {
  const allEmails: InstantlyEmail[] = [];
  let cursor: string | undefined = resumeCursor;
  let page = 0;
  let outcome: FetchOutcome = "reached_end";

  while (true) {
    // Time-budget check — leave room for processing. If we bail here the
    // caller persists `cursor` so the next sync picks up from this exact
    // page, so large histories back-fill across multiple runs.
    if (Date.now() - startTime > timeBudgetMs * 0.5) {
      console.log(`[sync] Fetch phase hit 50% time budget after ${page} pages — will resume from cursor on next sync`);
      outcome = "time_budget";
      break;
    }

    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      sort_order: "desc", // Newest first — lets delta syncs early-terminate
      // Include ALL folders (Primary + Others). Default is emode_focused which
      // silently hides "Others"-bucketed emails and caused per-workspace
      // history gaps — e.g. an account with lots of reply-filtered mail would
      // stop backfilling as soon as Instantly ran out of Primary items, even
      // though older Others-folder emails still existed.
      mode: "emode_all",
    };
    if (cursor) params.starting_after = cursor;

    page++;
    console.log(`[sync] Fetching emails page ${page}${cursor ? ` (cursor: ${cursor.slice(0, 8)}...)` : ""}${resumeCursor && page === 1 ? " [resuming backfill]" : ""}`);
    await updateSyncProgress(integrationId, {
      stage: "fetching_pages",
      message: `Fetching page ${page} of emails (${allEmails.length} so far)`,
      current: page,
      percent: Math.min(10 + page * 5, 55),
    });
    const data = await rateLimitedFetch(apiKey, "/emails", params);
    const items = (data.items || []) as InstantlyEmail[];

    if (items.length === 0) break;
    allEmails.push(...items);

    const newInPage = items.filter((e) => !existingIds.has(e.id)).length;
    const pctNew = newInPage / items.length;
    console.log(`[sync] Page ${page}: ${items.length} emails, ${newInPage} new (${Math.round(pctNew * 100)}%) — total fetched: ${allEmails.length}`);

    // Early termination — only safe after a full historical backfill. Before
    // that, the "mostly-old" pattern fires on page 2 for accounts that have
    // recent activity + a historical gap, and we'd never paginate back far
    // enough to fill the gap.
    if (allowEarlyTermination && pctNew < 0.2 && page > 1) {
      console.log(`[sync] Early termination: page ${page} is mostly old data`);
      outcome = "early_terminated";
      break;
    }

    cursor = data.next_starting_after as string | undefined;
    // Only the absent cursor signals end-of-history. A partial page
    // (items.length < PAGE_SIZE) can happen mid-walk when Instantly's
    // response size limits or filter modes trim a page — breaking on it
    // used to end the backfill prematurely and flip `backfillComplete=true`
    // with older emails still unfetched.
    if (!cursor) break;
  }

  return { emails: allEmails, outcome, nextCursor: cursor };
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
  await updateSyncProgress(integrationId, {
    stage: "starting",
    message: "Starting Instantly sync",
    percent: 2,
  });

  await updateSyncProgress(integrationId, {
    stage: "fetching_campaigns",
    message: "Loading campaigns",
    percent: 5,
  });
  const campaignMap = await fetchCampaigns(apiKey);
  console.log(`[sync] Found ${campaignMap.size} campaigns`);

  // Batch dedup — load every Instantly externalId ever seen for this
  // workspace. Previously scoped to 90 days, which made the early-termination
  // heuristic wrong: historical pages returned false-positive "all new" and
  // we'd stop before reaching them. Scales fine — each id is ~24 chars, so
  // even a million-message workspace is < 50MB.
  const existingIds = new Set(
    (await prisma.message.findMany({
      where: {
        workspaceId,
        externalId: { not: null },
        NOT: { externalId: { startsWith: "hr_" } },
      },
      select: { externalId: true },
    })).map((m) => m.externalId).filter(Boolean)
  );

  // Backfill state. For large Instantly accounts one sync run can't walk the
  // full history inside Vercel's 300s function limit — we save a resume
  // cursor when the fetch phase hits its time budget, so subsequent syncs
  // pick up where the last one stopped. Once we've reached the end of
  // Instantly's history, `backfillComplete` goes true and future syncs use
  // delta mode (early termination) for efficiency.
  const config = ((integration.config as Record<string, unknown>) ?? {});
  const backfillComplete = config.instantlyBackfillComplete === true;
  const resumeCursor = config.instantlyBackfillCursor as string | undefined;

  const { emails, outcome, nextCursor } = await fetchEmailsIncremental(
    integrationId,
    apiKey,
    existingIds as Set<string>,
    timeBudgetMs,
    startTime,
    resumeCursor,
    backfillComplete,
  );
  console.log(`[sync] Fetched ${emails.length} emails from Instantly (outcome: ${outcome}${resumeCursor ? ", resumed" : ""})`);

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

  await updateSyncProgress(integrationId, {
    stage: "processing",
    message: `Processing ${newEmails.length} new messages`,
    total: newEmails.length,
    current: 0,
    percent: 60,
  });

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

    if (synced > 0 && synced % 25 === 0) {
      await updateSyncProgress(integrationId, {
        stage: "processing",
        message: `Processed ${synced}/${newEmails.length} messages`,
        current: synced,
        total: newEmails.length,
        percent: Math.min(
          60 + Math.floor((synced / Math.max(newEmails.length, 1)) * 30),
          89,
        ),
      });
    }
  }

  await updateSyncProgress(integrationId, {
    stage: "finalizing",
    message: "Finalizing",
    percent: 95,
  });

  // Persist backfill progress. Re-read config because other writes (progress
  // beats) may have mutated it during this run.
  const freshRow = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });
  const freshConfig = ((freshRow?.config as Record<string, unknown>) ?? {});
  if (outcome === "time_budget" && nextCursor) {
    // Ran out of time mid-walk — resume here next run.
    freshConfig.instantlyBackfillCursor = nextCursor;
  } else if (outcome === "reached_end") {
    // Walked to the end of Instantly's history. Backfill is complete;
    // future syncs run in efficient delta mode (early termination on).
    freshConfig.instantlyBackfillComplete = true;
    delete freshConfig.instantlyBackfillCursor;
  }
  // outcome === "early_terminated" only fires when backfillComplete is
  // already true, so no state change needed.
  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: freshConfig as object, lastSyncAt: new Date() },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[sync] Instantly sync complete in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors`);
  await updateSyncProgress(integrationId, {
    stage: "done",
    message: `Synced ${synced} new messages`,
    percent: 100,
  });
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
