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

// Case-insensitive payload field extraction. Instantly leads carry a `payload`
// object with every column from the original CSV upload. Column names vary
// wildly ("company", "Company Name", "company_name", …) so we try many common
// variations and return the first truthy string value.
function extractFromPayload(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const val = payload[key];
    if (val && typeof val === "string" && val.trim()) return val.trim();
  }
  return undefined;
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

// Cached prospect data from pre-fetch — used during enrichment loop to
// determine whether a lead already exists and to access its thread ID.
type CachedProspect = {
  email: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  thread: {
    id: string;
    messages: { bodyText: string | null; messageText: string | null }[];
  } | null;
};

/**
 * Build the enrichment update data for a single Instantly lead.
 * Shared between the import (new) and update (existing) paths.
 */
function buildUpdateData(
  lead: InstantlyLead,
  email: string,
  existingLinkedinUrl: string | null,
  statusLabel: string,
  campaignNameMap: Map<string, string>,
) {
  const payload = lead.payload || {};
  const updateData: Record<string, unknown> = {};

  // First name
  updateData.firstName =
    lead.first_name ||
    extractFromPayload(payload, "first_name", "firstName", "First Name", "First name", "first") ||
    undefined;

  // Last name
  updateData.lastName =
    lead.last_name ||
    extractFromPayload(payload, "last_name", "lastName", "Last Name", "Last name", "last") ||
    undefined;

  // Company
  updateData.company =
    lead.company_name ||
    extractFromPayload(
      payload,
      "company", "Company", "company_name", "companyName", "Company Name",
      "organization", "Organization", "org", "Org", "account", "Account",
      "company_name_for_emails",
    ) ||
    undefined;

  // Domain — top-level > payload > derived from email
  updateData.domain =
    lead.company_domain ||
    extractFromPayload(
      payload,
      "domain", "Domain", "company_domain", "companyDomain", "Company Domain",
      "website", "Website", "url", "URL", "company_url", "company_website",
    ) ||
    email.split("@")[1] ||
    undefined;

  // Phone
  updateData.phone =
    lead.phone ||
    extractFromPayload(
      payload,
      "phone", "Phone", "phone_number", "phoneNumber", "Phone Number",
      "mobile", "Mobile", "mobile_phone", "direct_phone", "Direct Phone",
      "work_phone", "Work Phone", "cell", "Cell",
    ) ||
    undefined;

  // Title / Job Title
  updateData.title =
    extractFromPayload(
      payload,
      "title", "Title", "job_title", "jobTitle", "Job Title",
      "position", "Position", "role", "Role", "designation", "Designation",
    ) ||
    undefined;

  // LinkedIn URL — only fill if prospect doesn't already have one
  if (!existingLinkedinUrl) {
    const linkedinUrl = extractFromPayload(
      payload,
      "linkedin", "LinkedIn", "linkedin_url", "linkedinUrl", "LinkedIn URL",
      "linkedin_profile", "li_url", "LinkedInURL",
    );
    if (linkedinUrl) updateData.linkedinUrl = linkedinUrl;
  }

  // Lead status
  updateData.leadStatus = statusLabel;

  // Campaign name
  if (lead.campaign && campaignNameMap.has(lead.campaign)) {
    updateData.campaignName = campaignNameMap.get(lead.campaign);
  }

  // Step replied
  if (lead.email_reply_count && lead.email_reply_count > 0) {
    updateData.stepReplied = `Step ${(lead.email_opened_step || 0) + 1}`;
  }

  // Source date
  if (lead.timestamp_created) {
    updateData.sourceDate = new Date(lead.timestamp_created);
  }

  // Strip undefined values so Prisma doesn't overwrite existing data with null
  for (const key of Object.keys(updateData)) {
    if (updateData[key] === undefined) delete updateData[key];
  }

  return updateData;
}

export async function enrichFromInstantly(
  integrationId: string,
  /** Total milliseconds this enrichment run is allowed to use. Default 120s. */
  timeBudgetMs = 120_000,
): Promise<{
  enriched: number;
  imported: number;
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

  // 1. Get campaigns once for name lookup.
  const campaignData = await rateLimitedGet(apiKey, "/campaigns", { limit: "100" });
  const campaigns = (campaignData.items || []) as { id: string; name: string }[];
  console.log(`[enrich] Found ${campaigns.length} campaigns`);

  const campaignNameMap = new Map<string, string>();
  for (const c of campaigns) campaignNameMap.set(c.id, c.name);

  // 1b. Pre-fetch custom tags (free-form tags from Instantly UI).
  const customTagById = new Map<string, string>();
  try {
    const tagsData = await rateLimitedGet(apiKey, "/custom-tags", { limit: "100" });
    const tagItems = (tagsData.items || []) as InstantlyCustomTag[];
    for (const t of tagItems) customTagById.set(t.id, t.label);
    console.log(`[enrich] Loaded ${customTagById.size} custom tags from Instantly`);
  } catch (err) {
    console.warn(`[enrich] Failed to load custom tags (continuing without):`, err instanceof Error ? err.message : err);
  }

  // 2. Pre-fetch workspace labels.
  const allLabels = await prisma.label.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  });
  const labelByName = new Map(
    allLabels.map((l) => [l.name.toLowerCase(), l])
  );

  // 3. Pre-fetch ALL existing prospects (with thread data) into a Map for
  //    O(1) lookup. This lets us skip per-prospect API calls entirely — we
  //    iterate Instantly leads once and match them locally.
  const existingProspects = await prisma.prospect.findMany({
    where: { workspaceId, email: { not: null } },
    select: {
      email: true,
      linkedinUrl: true,
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
  });
  const prospectByEmail = new Map<string, CachedProspect>(
    existingProspects.map((p) => [p.email!.toLowerCase(), p])
  );
  console.log(`[enrich] ${prospectByEmail.size} existing prospects in workspace`);

  // 4. Paginate through ALL Instantly leads. For each lead:
  //    - If prospect exists in DB → update (enrich)
  //    - If prospect is new AND the lead has replied or been tagged → create (import)
  //    Over multiple cron cycles the cursor progresses through the full list.
  let cursor: string | undefined;
  let enriched = 0;
  let imported = 0;
  let errors = 0;
  let processed = 0;
  let pages = 0;

  while (Date.now() - startTime < timeBudgetMs) {
    const data = await rateLimitedPost(apiKey, "/leads/list", {
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    const items = (data.items || []) as InstantlyLead[];
    pages++;

    if (items.length === 0) break;
    console.log(`[enrich] Page ${pages}: ${items.length} leads`);

    for (const lead of items) {
      if (Date.now() - startTime > timeBudgetMs) break;
      if (!lead.email) continue;
      processed++;

      try {
        const emailLower = lead.email.toLowerCase();
        const existing = prospectByEmail.get(emailLower);

        // Map interest status
        const rawInterest = lead.lt_interest_status;
        const interestLabel =
          rawInterest !== undefined && rawInterest !== null && rawInterest !== 0
            ? INTEREST_STATUS_MAP[rawInterest]
            : undefined;
        if (rawInterest !== undefined && rawInterest !== null && rawInterest !== 0 && !interestLabel) {
          console.warn(`[enrich] Unknown lt_interest_status=${rawInterest} for ${lead.email}`);
        }
        const statusLabel =
          interestLabel || getCampaignStatus(lead.status, lead.email_reply_count);

        // Resolve custom tags
        const customTagLabels = (lead.custom_tag_ids ?? [])
          .map((id) => customTagById.get(id))
          .filter((name): name is string => !!name);

        // Build update data
        const updateData = buildUpdateData(
          lead, lead.email,
          existing?.linkedinUrl ?? null,
          statusLabel, campaignNameMap,
        );

        let threadId: string | null = null;

        if (existing) {
          // ---- UPDATE existing prospect ----
          // Set notes to latest reply if not already set
          if (!existing.notes && existing.thread?.messages?.[0]) {
            const reply = existing.thread.messages[0];
            const replyText = reply.bodyText || reply.messageText;
            if (replyText) updateData.notes = replyText.slice(0, 500);
          }

          await prisma.prospect.update({
            where: { workspaceId_email: { workspaceId, email: lead.email } },
            data: updateData,
          });
          threadId = existing.thread?.id ?? null;
          enriched++;
        } else {
          // ---- IMPORT new lead ----
          // Strict gate: only import leads that have actually replied OR have
          // been tagged in Instantly. Everything else (in-sequence, finished,
          // bounced, etc.) is noise until they engage.
          const hasReply = (lead.email_reply_count ?? 0) > 0;
          const hasTag = !!interestLabel || customTagLabels.length > 0;
          if (!hasReply && !hasTag) {
            continue; // No reply and no tag — skip import
          }

          try {
            const prospect = await prisma.prospect.create({
              data: {
                workspaceId,
                email: lead.email,
                ...updateData,
              },
            });
            const thread = await prisma.thread.create({
              data: {
                workspaceId,
                prospectId: prospect.id,
                channel: "EMAIL",
                status: "OPEN",
                isUnread: false,
                lastMessageAt: (updateData.sourceDate as Date) || new Date(),
              },
            });
            threadId = thread.id;
            // Cache so we don't try to create again on a later page
            prospectByEmail.set(emailLower, {
              email: lead.email,
              linkedinUrl: (updateData.linkedinUrl as string) ?? null,
              notes: null,
              thread: { id: thread.id, messages: [] },
            });
            imported++;
          } catch (err: unknown) {
            // P2002 = unique constraint — prospect was created by a concurrent sync
            if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
              // Already exists — just skip, will enrich on next cycle
              prospectByEmail.set(emailLower, { email: lead.email, linkedinUrl: null, notes: null, thread: null });
              continue;
            }
            throw err;
          }
        }

        // Apply labels (interest status + custom tags) to thread
        if (threadId) {
          const labelsToApply = new Map<string, string>();
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
                where: { workspaceId_name: { workspaceId, name: labelName } },
                create: { workspaceId, name: labelName, color: colorForStatus(labelName) },
                update: {},
                select: { id: true, name: true },
              });
              labelByName.set(lowerKey, label);
            }
            await prisma.threadLabel.upsert({
              where: { threadId_labelId: { threadId, labelId: label.id } },
              create: { threadId, labelId: label.id, source: "WEBHOOK", confidence: 1.0 },
              update: {},
            });
          }
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`[enrich] Error for ${lead.email}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    cursor = data.next_starting_after as string | undefined;
    if (!cursor || items.length < 100) break;
  }

  if (Date.now() - startTime >= timeBudgetMs) {
    console.log(`[enrich] Time budget exhausted at page ${pages}, ${processed} leads processed — will continue next cycle`);
  }

  console.log(`[enrich] Done: ${enriched} enriched, ${imported} imported, ${campaigns.length} campaigns, ${errors} errors`);
  return { enriched, imported, campaigns: campaigns.length, errors };
}
