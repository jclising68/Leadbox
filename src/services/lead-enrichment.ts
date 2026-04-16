import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const MIN_REQUEST_GAP_MS = 1000; // Match sync rate — 1 req/sec is safely under Instantly v2 limits

// Per-API-key rate limiter state. Using a Map (instead of a single
// `lastRequestTime` global) lets multiple workspaces' enrichments run in
// parallel without one workspace's pacing penalising another's. Keyed by
// API key — each Instantly account has its own quota anyway.
const lastRequestByKey = new Map<string, number>();

// Instantly `lt_interest_status` mapping.
//
// Reference: https://developer.instantly.ai — confirmed against /leads/list
// responses in production. Positive values are "soft" (the lead expressed
// interest), negatives are "hard" (won't proceed). `0` means "not set" and
// must NOT be mapped (was previously mis-mapped to "Not Interested", which
// would have flooded the inbox once the guard was relaxed).
const INTEREST_STATUS_MAP: Record<number, string> = {
  1: "Interested",
  2: "Meeting Booked",
  3: "Meeting Completed",
  4: "Closed",
  [-1]: "Not Interested",
  [-2]: "Wrong Person",
  [-3]: "Lost",
  [-4]: "Out of Office",
};

// Pick a sensible default color for an auto-created label based on its name.
// Matches the UI conventions used by getStatusColor() on the leads page.
function colorForStatus(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("interested") && !n.includes("not")) return "#22C55E"; // green
  if (n.includes("not interested")) return "#EF4444"; // red
  if (n.includes("meeting")) return "#3B82F6"; // blue
  if (n.includes("closed") || n.includes("won")) return "#10B981"; // emerald
  if (n.includes("out of office")) return "#6B7280"; // gray
  if (n.includes("wrong person")) return "#F97316"; // orange
  if (n.includes("auto reply")) return "#EC4899"; // pink
  if (n.includes("future") || n.includes("not the right time")) return "#EAB308"; // yellow
  return "#8B5CF6"; // violet (default)
}

// Instantly campaign status mapping (lead progress through campaign)
function getCampaignStatus(status: number | undefined, replyCount: number | undefined): string {
  if (replyCount && replyCount > 0) return "Replied";
  switch (status) {
    case 0: return "Not Started";
    case 1: return "In Progress";
    case 2: return "Paused";
    case 3: return "Completed";
    case -1: return "Bounced";
    case -2: return "Unsubscribed";
    default: return "Lead";
  }
}

async function pacePerKey(apiKey: string) {
  const last = lastRequestByKey.get(apiKey) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestByKey.set(apiKey, Date.now());
}

async function rateLimitedPost(apiKey: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await pacePerKey(apiKey);

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${INSTANTLY_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const wait = Math.min(10000 * Math.pow(2, attempt), 120000);
      console.log(`[enrich] Rate limited, waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      lastRequestByKey.set(apiKey, Date.now());
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly API ${res.status}: ${text}`);
    }

    return res.json() as Promise<Record<string, unknown>>;
  }
  throw new Error("Instantly API rate limit after retries");
}

async function rateLimitedGet(apiKey: string, path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
  await pacePerKey(apiKey);

  const url = new URL(`${INSTANTLY_API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 429) {
      const wait = Math.min(10000 * Math.pow(2, attempt), 120000);
      await new Promise((r) => setTimeout(r, wait));
      lastRequestByKey.set(apiKey, Date.now());
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly API ${res.status}: ${text}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }
  throw new Error("Instantly API rate limit after retries");
}

type InstantlyLead = {
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_domain?: string;
  phone?: string;
  website?: string;
  lt_interest_status?: number | null;
  status?: number;
  campaign?: string;
  payload?: Record<string, unknown>;
  email_reply_count?: number;
  email_opened_step?: number;
  timestamp_created?: string;
  timestamp_last_contact?: string;
  /** UUIDs of custom tags assigned to this lead (manual tags from Instantly UI). */
  custom_tag_ids?: string[];
};

type InstantlyCustomTag = { id: string; label: string };

export async function enrichFromInstantly(
  integrationId: string,
  /** Total milliseconds this enrichment run is allowed to use. Default 120s. */
  timeBudgetMs = 120_000,
): Promise<{
  enriched: number;
  campaigns: number;
  errors: number;
}> {
  const startTime = Date.now();
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(integration.apiKeyEncrypted, integration.apiKeyIv, integration.apiKeyTag);
  const workspaceId = integration.workspaceId;

  console.log(`[enrich] Starting enrichment for integration ${integrationId} (budget: ${Math.round(timeBudgetMs / 1000)}s)`);

  // 1. Get campaigns once for name lookup. Limit 100 covers any realistic
  //    workspace; we only use these names to populate `campaignName` on the
  //    prospect, not to drive iteration anymore.
  const campaignData = await rateLimitedGet(apiKey, "/campaigns", { limit: "100" });
  const campaigns = (campaignData.items || []) as { id: string; name: string }[];
  console.log(`[enrich] Found ${campaigns.length} campaigns`);

  const campaignNameMap = new Map<string, string>();
  for (const c of campaigns) campaignNameMap.set(c.id, c.name);

  // 1b. Pre-fetch custom tags — these are the free-form tags applied in
  //    Instantly's UI (separate from the Status dropdown's lt_interest_status).
  //    We map id → label so we can translate lead.custom_tag_ids back to names
  //    and apply them on the thread. Without this, anything the user tagged
  //    manually in Instantly would never reflect in LeadBox.
  const customTagById = new Map<string, string>();
  try {
    const tagsData = await rateLimitedGet(apiKey, "/custom-tags", { limit: "100" });
    const tagItems = (tagsData.items || []) as InstantlyCustomTag[];
    for (const t of tagItems) customTagById.set(t.id, t.label);
    console.log(`[enrich] Loaded ${customTagById.size} custom tags from Instantly`);
  } catch (err) {
    console.warn(`[enrich] Failed to load custom tags (continuing without):`, err instanceof Error ? err.message : err);
  }

  // 2. Pre-fetch labels.
  const allLabels = await prisma.label.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  });
  const labelByName = new Map(
    allLabels.map((l) => [l.name.toLowerCase(), l])
  );

  // 3. Fetch only EMAIL-channel prospects (Instantly conversations live there;
  //    HeyReach prospects can have an email too but they aren't in Instantly).
  //    Order by `updatedAt ASC` so the stalest prospects are refreshed first —
  //    over multiple cron cycles this guarantees every prospect eventually
  //    gets enriched even when a workspace has more prospects than the time
  //    budget can cover in one run.
  const prospects = await prisma.prospect.findMany({
    where: {
      workspaceId,
      email: { not: null },
      thread: { channel: "EMAIL" },
    },
    select: {
      id: true,
      email: true,
      notes: true,
      thread: {
        select: {
          id: true,
          messages: {
            where: { direction: "INBOUND" },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { bodyText: true, messageText: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`[enrich] ${prospects.length} email-channel prospects to refresh`);

  let enriched = 0;
  let errors = 0;
  let processed = 0;

  // 4. For each prospect, look up their lead in Instantly via search.
  //    This is O(prospects) — the previous campaign-walking approach was
  //    O(all_instantly_leads) and timed out before reaching most prospects.
  for (const prospect of prospects) {
    if (Date.now() - startTime > timeBudgetMs) {
      console.log(`[enrich] Time budget exhausted at ${processed}/${prospects.length} prospects (${enriched} enriched)`);
      break;
    }
    if (!prospect.email) continue;

    processed++;

    try {
      const data = await rateLimitedPost(apiKey, "/leads/list", {
        search: prospect.email,
        limit: 10,
      });
      const items = (data.items || []) as InstantlyLead[];

      // Pick the exact email match — `search` can return fuzzy matches.
      const lead = items.find(
        (l) => l.email?.toLowerCase() === prospect.email!.toLowerCase()
      );
      if (!lead) continue;

      // Map interest status. `0`/null/undefined mean "not set" — only look
      // up labels for known values. Previously the `>= 0` guard was dropping
      // every Not Interested (-1), Wrong Person (-2), Lost (-3), and Out of
      // Office (-4), which is why those statuses never reflected in LeadBox.
      const rawInterest = lead.lt_interest_status;
      const interestLabel =
        rawInterest !== undefined && rawInterest !== null && rawInterest !== 0
          ? INTEREST_STATUS_MAP[rawInterest]
          : undefined;
      // Surface unknown codes in logs so we can expand the map rather than
      // silently dropping data. (Keeps volume low — only logs if non-zero
      // and unmapped.)
      if (rawInterest !== undefined && rawInterest !== null && rawInterest !== 0 && !interestLabel) {
        console.warn(`[enrich] Unknown lt_interest_status=${rawInterest} for ${prospect.email}`);
      }
      const statusLabel =
        interestLabel || getCampaignStatus(lead.status, lead.email_reply_count);

      // Resolve any manually-applied custom tags from Instantly UI.
      // These coexist with the Status dropdown, so a lead can have both
      // an interest status AND additional free-form tags.
      const customTagLabels = (lead.custom_tag_ids ?? [])
        .map((id) => customTagById.get(id))
        .filter((name): name is string => !!name);

      // Determine step replied
      let stepReplied: string | undefined;
      if (lead.email_reply_count && lead.email_reply_count > 0) {
        stepReplied = `Step ${(lead.email_opened_step || 0) + 1}`;
      }

      const updateData: Record<string, unknown> = {};
      if (lead.first_name) updateData.firstName = lead.first_name;
      if (lead.last_name) updateData.lastName = lead.last_name;
      if (lead.company_name) updateData.company = lead.company_name;
      if (lead.company_domain) updateData.domain = lead.company_domain;
      if (lead.phone) updateData.phone = lead.phone;
      updateData.leadStatus = statusLabel;
      if (lead.campaign && campaignNameMap.has(lead.campaign)) {
        updateData.campaignName = campaignNameMap.get(lead.campaign);
      }
      if (stepReplied) updateData.stepReplied = stepReplied;

      if (lead.timestamp_created) {
        updateData.sourceDate = new Date(lead.timestamp_created);
      }

      // Extract title from payload if available
      const payload = lead.payload || {};
      if (payload.title || payload.Title || payload.jobTitle || payload.job_title) {
        updateData.title = (payload.title || payload.Title || payload.jobTitle || payload.job_title) as string;
      }
      if (payload.phone || payload.Phone || payload.phoneNumber) {
        updateData.phone = (updateData.phone as string | undefined) || (payload.phone || payload.Phone || payload.phoneNumber) as string;
      }

      // Set notes to latest reply if not already set
      if (!prospect.notes) {
        const latestReply = prospect.thread?.messages?.[0];
        if (latestReply) {
          const replyText = latestReply.bodyText || latestReply.messageText;
          if (replyText) {
            updateData.notes = replyText.slice(0, 500);
          }
        }
      }

      await prisma.prospect.update({
        where: { workspaceId_email: { workspaceId, email: prospect.email } },
        data: updateData,
      });
      enriched++;

      // Apply all labels that came from Instantly — interest status + any
      // manual custom tags. De-duped case-insensitively so a tag named
      // "Interested" doesn't also get applied as a separate "INTERESTED".
      if (prospect.thread) {
        const labelsToApply = new Map<string, string>(); // lowercaseKey -> originalName
        if (interestLabel) {
          labelsToApply.set(interestLabel.toLowerCase(), interestLabel);
        }
        for (const tagName of customTagLabels) {
          labelsToApply.set(tagName.toLowerCase(), tagName);
        }

        for (const [lowerKey, labelName] of labelsToApply) {
          let label = labelByName.get(lowerKey);
          if (!label) {
            label = await prisma.label.upsert({
              where: {
                workspaceId_name: { workspaceId, name: labelName },
              },
              create: {
                workspaceId,
                name: labelName,
                color: colorForStatus(labelName),
              },
              update: {},
              select: { id: true, name: true },
            });
            labelByName.set(lowerKey, label);
          }
          await prisma.threadLabel.upsert({
            where: {
              threadId_labelId: { threadId: prospect.thread.id, labelId: label.id },
            },
            create: {
              threadId: prospect.thread.id,
              labelId: label.id,
              source: "WEBHOOK",
              confidence: 1.0,
            },
            update: {},
          });
        }
      }
    } catch (err) {
      errors++;
      if (errors <= 3) {
        console.error(`[enrich] Error for ${prospect.email}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`[enrich] Done: ${enriched}/${processed} enriched, ${campaigns.length} campaigns, ${errors} errors`);
  return { enriched, campaigns: campaigns.length, errors };
}
