import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import { updateSyncProgress } from "@/services/sync-progress";
import { applyAutoLabel } from "@/services/auto-labeler";
import { INTEREST_STATUS_TO_LABEL } from "@/services/provider-tags";
import type { NormalizedWebhookPayload } from "@/types";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const PAGE_SIZE = 100;
// 10 req/s — measured with a direct burst probe against Instantly's v2 API:
// 10 req/s sustained produced 0 × 429s; 30 req/s sustained was clean; 100 req/s
// bursts trip rate-limit token-bucket. 10 keeps us well under the throttle and
// still roughly 10× faster than the previous 1 req/s pace. The per-request 429
// backoff below is the safety net if Instantly tightens server-side.
const MIN_REQUEST_GAP_MS = 100;

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
  /** Stop walking (and flag backfillComplete) once we reach an email older
   *  than this. Lets the user scope initial backfill to e.g. 2026-only
   *  history and explicitly opt into older data via an "Expand" action.
   *  Undefined means walk to the beginning of the account. */
  cutoffDate: Date | undefined,
): Promise<{ emails: InstantlyEmail[]; outcome: FetchOutcome; nextCursor?: string; oldestReached?: Date }> {
  const allEmails: InstantlyEmail[] = [];
  let cursor: string | undefined = resumeCursor;
  let page = 0;
  let outcome: FetchOutcome = "reached_end";
  let oldestReached: Date | undefined;

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
      sort_order: "desc",
      // emode_all includes Primary + Others folders; the default emode_focused
      // silently hides Others-bucketed emails.
      mode: "emode_all",
    };
    if (cursor) params.starting_after = cursor;

    page++;
    console.log(`[sync] Fetching emails page ${page}${cursor ? ` (cursor: ${cursor.slice(0, 8)}...)` : ""}${resumeCursor && page === 1 ? " [resuming backfill]" : ""}`);
    const reachedLabel = oldestReached
      ? ` (reached ${oldestReached.toISOString().slice(0, 10)})`
      : "";
    await updateSyncProgress(integrationId, {
      stage: "fetching_pages",
      message: `Fetched ${allEmails.length} emails · page ${page}${reachedLabel}`,
      current: allEmails.length,
      total: allEmails.length,
      percent: 0,
    });
    const data = await rateLimitedFetch(apiKey, "/emails", params);
    const items = (data.items || []) as InstantlyEmail[];
    const apiCursor = data.next_starting_after as string | undefined;

    if (items.length === 0) {
      // Use Instantly's own next_starting_after as the source of truth:
      //   absent/null       → walked past the last email (true end)
      //   same as our cursor → dead-cursor loop, treat as end
      //   present & different → transient empty; save the advanced cursor
      // An earlier fix chose to always preserve the old cursor here to avoid
      // premature "done" flips, which stalled backfill forever when Instantly
      // returned a dead cursor. Trusting the API's own signal resolves both.
      if (!apiCursor || apiCursor === cursor) break; // outcome stays reached_end
      if (page === 1 && !resumeCursor) break;
      console.log(`[sync] Empty items page mid-walk, advancing to ${apiCursor.slice(0, 8)}... for next run`);
      outcome = "time_budget";
      return { emails: allEmails, outcome, nextCursor: apiCursor };
    }
    // Cutoff filter: walking DESC means the newest items are first, oldest
    // last. Keep everything above the cutoff, stop once this page's oldest
    // item falls below it (marking backfill complete for this cutoff).
    let cutoffReached = false;
    for (const e of items) {
      const ts = e.timestamp_created ? new Date(e.timestamp_created) : null;
      if (cutoffDate && ts && ts < cutoffDate) {
        cutoffReached = true;
        continue;
      }
      allEmails.push(e);
      if (ts && (!oldestReached || ts < oldestReached)) oldestReached = ts;
    }

    const newInPage = items.filter((e) => !existingIds.has(e.id)).length;
    const pctNew = items.length ? newInPage / items.length : 0;
    console.log(`[sync] Page ${page}: ${items.length} emails, ${newInPage} new (${Math.round(pctNew * 100)}%) — total fetched: ${allEmails.length}${cutoffReached ? " (cutoff reached)" : ""}`);

    if (cutoffReached) {
      outcome = "reached_end";
      break;
    }

    // Early termination only safe after a full historical backfill — before
    // that, a mostly-old page on page 2 can skip an unfilled historical gap.
    if (allowEarlyTermination && pctNew < 0.2 && page > 1) {
      console.log(`[sync] Early termination: page ${page} is mostly old data`);
      outcome = "early_terminated";
      break;
    }

    cursor = apiCursor;
    // Absent cursor = true end-of-history. A partial page (items.length <
    // PAGE_SIZE) mid-walk is normal when filter modes trim output.
    if (!cursor) break;
  }

  return { emails: allEmails, outcome, nextCursor: cursor, oldestReached };
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

/**
 * For each replied lead UUID we just processed, fetch lt_interest_status from
 * Instantly and apply it as a WEBHOOK-source label in LeadBox. Only runs for
 * leads whose status maps to a known built-in value (skips custom negatives).
 * One GET /leads/{id} call per UUID — already within the 10 req/s budget.
 */
async function syncLeadStatuses(
  workspaceId: string,
  apiKey: string,
  leadIds: Set<string>,
): Promise<void> {
  if (!leadIds.size) return;
  console.log(`[sync] Syncing lt_interest_status for ${leadIds.size} replied lead(s)`);

  for (const leadId of leadIds) {
    await pacePerKey(apiKey);
    try {
      const res = await fetch(`${INSTANTLY_API_BASE}/leads/${leadId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) continue;
      const lead = await res.json() as { email?: string; lt_interest_status?: number };
      const code = lead.lt_interest_status;
      if (code === undefined || code === null) continue;
      const labelName = INTEREST_STATUS_TO_LABEL.get(code);
      if (!labelName) continue; // custom status — skip

      // Find the thread for this prospect in this workspace
      const thread = await prisma.thread.findFirst({
        where: {
          workspaceId,
          prospect: { email: lead.email },
        },
        select: { id: true },
        orderBy: { lastMessageAt: "desc" },
      });
      if (!thread) continue;

      await applyAutoLabel(workspaceId, thread.id, labelName, 1.0, "WEBHOOK");
      console.log(`[sync] Applied "${labelName}" to thread ${thread.id} from Instantly lt_interest_status=${code}`);
    } catch (err) {
      console.error(`[sync] Failed to sync status for lead ${leadId}:`, err instanceof Error ? err.message : err);
    }
  }
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
    message: "Starting sync",
    percent: 0,
  });

  await updateSyncProgress(integrationId, {
    stage: "fetching_campaigns",
    message: "Loading campaigns",
    percent: 0,
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

  // One run can't walk a large account inside Vercel's 300s limit, so we
  // save the cursor on time-budget exit and resume next run. `backfillComplete`
  // flips true once Instantly signals end-of-history, after which syncs run
  // in delta mode (early termination).
  const config = ((integration.config as Record<string, unknown>) ?? {});
  const backfillComplete = config.instantlyBackfillComplete === true;
  const resumeCursor = config.instantlyBackfillCursor as string | undefined;

  // Backfill horizon. Defaults to 2026-01-01; "Expand history" action
  // overrides it and re-opens backfillComplete so we continue further back.
  const cutoffIso = (config.backfillCutoffDate as string | undefined) ?? "2026-01-01T00:00:00.000Z";
  const cutoffDate = new Date(cutoffIso);
  console.log(`[sync] Backfill cutoff: ${cutoffDate.toISOString()}`);

  const { emails, outcome, nextCursor, oldestReached } = await fetchEmailsIncremental(
    integrationId,
    apiKey,
    existingIds as Set<string>,
    timeBudgetMs,
    startTime,
    resumeCursor,
    backfillComplete,
    cutoffDate,
  );
  console.log(`[sync] Fetched ${emails.length} emails from Instantly (outcome: ${outcome}${resumeCursor ? ", resumed" : ""}${oldestReached ? `, oldest ${oldestReached.toISOString()}` : ""})`);

  // Sort newest-first so recent data appears immediately.
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
  const repliedLeadIds = new Set<string>();

  await updateSyncProgress(integrationId, {
    stage: "processing",
    message: `Processing ${newEmails.length} new messages`,
    total: newEmails.length,
    current: 0,
    percent: newEmails.length > 0 ? 0 : 100,
  });

  // Process sequentially to keep thread ordering stable.
  for (const email of newEmails) {
    if (Date.now() - startTime > timeBudgetMs * 0.85) {
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
      // Collect replied lead UUIDs for status sync below
      if (email.ue_type === 2 && email.lead) {
        repliedLeadIds.add(email.lead);
      }
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
        percent: Math.floor((synced / newEmails.length) * 100),
      });
    }
  }

  // Sync lt_interest_status from Instantly back to LeadBox for replied leads.
  await syncLeadStatuses(workspaceId, apiKey, repliedLeadIds);

  // Re-read config — progress beats may have mutated it during this run.
  const freshRow = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });
  const freshConfig = ((freshRow?.config as Record<string, unknown>) ?? {});
  if (outcome === "time_budget" && nextCursor) {
    freshConfig.instantlyBackfillCursor = nextCursor;
  } else if (outcome === "reached_end") {
    freshConfig.instantlyBackfillComplete = true;
    delete freshConfig.instantlyBackfillCursor;
  }
  if (oldestReached) {
    const prev = freshConfig.instantlyOldestReached as string | undefined;
    if (!prev || new Date(prev) > oldestReached) {
      freshConfig.instantlyOldestReached = oldestReached.toISOString();
    }
  }
  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: freshConfig as object, lastSyncAt: new Date() },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[sync] Instantly sync complete in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors`);
  const doneMessage = outcome === "time_budget"
    ? `Synced ${synced} new · paused at ${oldestReached?.toISOString().slice(0, 10) ?? "cursor"} · will resume`
    : outcome === "reached_end"
      ? `Synced ${synced} new · reached ${oldestReached?.toISOString().slice(0, 10) ?? "end of history"}`
      : `Synced ${synced} new messages`;
  await updateSyncProgress(integrationId, {
    stage: "done",
    message: doneMessage,
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
