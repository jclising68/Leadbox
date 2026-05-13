import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import { updateSyncProgress } from "@/services/sync-progress";
import type { NormalizedWebhookPayload } from "@/types";

const LEMLIST_API_BASE = "https://api.lemlist.com/api";
const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";
const PAGE_SIZE = 100;
const MIN_REQUEST_GAP_MS = 200;

const lastRequestByKey = new Map<string, number>();

async function pace(apiKey: string) {
  const last = lastRequestByKey.get(apiKey) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestByKey.set(apiKey, Date.now());
}

async function lemlistGet(
  apiKey: string,
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(`${LEMLIST_API_BASE}${path}`);
  url.searchParams.set("access_token", apiKey);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  for (let attempt = 0; attempt <= 4; attempt++) {
    await pace(apiKey);
    const res = await fetch(url.toString());
    if (res.status === 429) {
      const waitMs = Math.min(10000 * Math.pow(2, attempt), 60000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lemlist API ${res.status}: ${text}`);
    }
    return res.json();
  }
  throw new Error("Lemlist API failed after retries");
}

// Call the Lemlist MCP to get full conversation (with full HTML body)
async function getConversation(
  apiKey: string,
  contactId: string
): Promise<Array<{ id: string; type: string; message?: string; createdAt?: string }>> {
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
        name: "get_inbox_conversation",
        arguments: { contactId, limit: 50 },
      },
    }),
  });

  if (!res.ok) return [];

  try {
    const data = (await res.json()) as {
      result?: { content?: Array<{ type: string; text: string }> };
    };
    const text = data.result?.content?.find((c) => c.type === "text")?.text;
    if (!text) return [];
    const parsed = JSON.parse(text) as {
      activities?: Array<{ id: string; type: string; message?: string; createdAt?: string }>;
    };
    return parsed.activities ?? [];
  } catch {
    return [];
  }
}

type LemlistActivity = {
  _id: string;
  type: string;
  createdAt?: string;
  leadEmail?: string;
  email?: string;
  fromEmail?: string;
  sendUserEmail?: string;
  sendUserMailboxId?: string;
  sendUserId?: string;
  sendUserMailboxProviderId?: string;
  subject?: string;
  messagePreview?: string;
  text?: string; // plain-text body for LinkedIn activities
  campaignId?: string;
  name?: string; // campaign name in activity
  leadFirstName?: string;
  leadLastName?: string;
  leadCompanyName?: string;
  contactId?: string;
  linkedinUrl?: string;
};

async function fetchActivities(
  apiKey: string,
  type: "emailsReplied" | "linkedinReplied" | "emailsSent" | "linkedinSent",
  offset: number
): Promise<LemlistActivity[]> {
  const data = (await lemlistGet(apiKey, "/activities", {
    type,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })) as LemlistActivity[];
  return Array.isArray(data) ? data : [];
}

async function fetchCampaigns(apiKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const data = (await lemlistGet(apiKey, "/campaigns", { limit: "100" })) as Array<{
      _id: string;
      name: string;
    }>;
    if (Array.isArray(data)) {
      for (const c of data) map.set(c._id, c.name);
    }
  } catch {
    console.log("[lemlist-sync] Could not fetch campaigns");
  }
  return map;
}

function activityToPayload(
  activity: LemlistActivity,
  bodyFromMcp: string | undefined,
  campaignMap: Map<string, string>,
  direction: "INBOUND" | "OUTBOUND"
): NormalizedWebhookPayload {
  const isLinkedin = activity.type.startsWith("linkedin");

  const campaignName = activity.campaignId
    ? (campaignMap.get(activity.campaignId) ?? activity.name)
    : activity.name;

  if (isLinkedin) {
    // LinkedIn: MCP returns plain text in `message` field; fall back to activity.text
    const messageText = bodyFromMcp ?? activity.text;
    return {
      provider: "LEMLIST",
      eventType: activity.type,
      direction,
      channel: "LINKEDIN",
      prospectEmail: activity.leadEmail || activity.email,
      prospectFirstName: activity.leadFirstName,
      prospectLastName: activity.leadLastName,
      prospectCompany: activity.leadCompanyName,
      prospectLinkedinUrl: activity.linkedinUrl,
      messageText,
      externalId: activity._id,
      campaignId: activity.campaignId,
      campaignName,
      sentAt: activity.createdAt ? new Date(activity.createdAt) : undefined,
      rawPayload: activity as unknown as Record<string, unknown>,
    };
  }

  // Email activity
  const bodyText = bodyFromMcp
    ? bodyFromMcp.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : activity.messagePreview;

  return {
    provider: "LEMLIST",
    eventType: activity.type,
    direction,
    channel: "EMAIL",
    prospectEmail: activity.leadEmail || activity.email || (direction === "INBOUND" ? activity.fromEmail : undefined),
    prospectFirstName: activity.leadFirstName,
    prospectLastName: activity.leadLastName,
    prospectCompany: activity.leadCompanyName,
    subject: activity.subject,
    bodyText,
    bodyHtml: bodyFromMcp,
    fromEmail:
      direction === "INBOUND"
        ? activity.fromEmail || activity.leadEmail
        : activity.sendUserEmail || activity.sendUserMailboxProviderId,
    toEmail:
      direction === "INBOUND"
        ? activity.sendUserEmail || activity.sendUserMailboxProviderId
        : activity.leadEmail || activity.email,
    externalId: activity._id,
    campaignId: activity.campaignId,
    campaignName,
    sentAt: activity.createdAt ? new Date(activity.createdAt) : undefined,
    rawPayload: activity as unknown as Record<string, unknown>,
  };
}

export async function syncLemlist(
  integrationId: string,
  timeBudgetMs = 250_000
): Promise<{ synced: number; skipped: number; errors: number }> {
  const startTime = Date.now();
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );
  const workspaceId = integration.workspaceId;

  console.log(`[lemlist-sync] Starting sync for integration ${integrationId}`);
  await updateSyncProgress(integrationId, {
    stage: "starting",
    message: "Starting Lemlist sync",
    percent: 0,
  });

  const campaignMap = await fetchCampaigns(apiKey);

  // Load all existing Lemlist externalIds so we can skip already-seen items.
  // Lemlist IDs start with "act_" — filter to those to avoid collision with Instantly/HeyReach.
  const existingIds = new Set(
    (
      await prisma.message.findMany({
        where: {
          workspaceId,
          externalId: { startsWith: "act_" },
        },
        select: { externalId: true },
      })
    )
      .map((m) => m.externalId)
      .filter(Boolean) as string[]
  );

  const config = ((integration.config as Record<string, unknown>) ?? {});
  const backfillComplete = config.lemlistBackfillComplete === true;

  // Fetch all new replied activities first (they need MCP body enrichment)
  await updateSyncProgress(integrationId, {
    stage: "fetching_pages",
    message: "Fetching Lemlist reply activities",
    percent: 5,
  });

  const newReplied: LemlistActivity[] = [];
  const newSent: LemlistActivity[] = [];

  for (const type of ["emailsReplied", "linkedinReplied", "emailsSent", "linkedinSent"] as const) {
    let offset = 0;
    let done = false;
    while (!done) {
      if (Date.now() - startTime > timeBudgetMs * 0.4) {
        console.log(`[lemlist-sync] Fetch phase hit 40% time budget — stopping early`);
        done = true;
        break;
      }

      const page = await fetchActivities(apiKey, type, offset);
      if (page.length === 0) {
        done = true;
        break;
      }

      const newInPage = page.filter((a) => !existingIds.has(a._id));
      const isInbound = type === "emailsReplied" || type === "linkedinReplied";
      if (isInbound) newReplied.push(...newInPage);
      else newSent.push(...newInPage);

      // Early termination: if all are old AND backfill was done before, stop
      if (backfillComplete && newInPage.length === 0) {
        done = true;
        break;
      }

      offset += PAGE_SIZE;
      if (page.length < PAGE_SIZE) {
        done = true;
        if (type === "linkedinSent") {
          // Mark backfill complete only after walking all four lists end-to-end
          config.lemlistBackfillComplete = true;
        }
      }
    }
  }

  console.log(
    `[lemlist-sync] ${newReplied.length} new replies, ${newSent.length} new sent to process`
  );

  // Fetch full HTML body for each unique contactId that has new replies
  const uniqueContactIds = [
    ...new Set(newReplied.map((a) => a.contactId).filter(Boolean) as string[]),
  ];

  const bodyMap = new Map<string, string>(); // activityId → full HTML body

  if (uniqueContactIds.length > 0) {
    await updateSyncProgress(integrationId, {
      stage: "fetching_pages",
      message: `Fetching full reply bodies (${uniqueContactIds.length} contacts)`,
      percent: 30,
    });

    for (const contactId of uniqueContactIds) {
      if (Date.now() - startTime > timeBudgetMs * 0.6) break;
      try {
        const activities = await getConversation(apiKey, contactId);
        for (const act of activities) {
          if (act.message) bodyMap.set(act.id, act.message);
        }
        // Small pause between MCP calls to be respectful
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.error(
          `[lemlist-sync] Failed to fetch conversation for ${contactId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  let synced = 0;
  let skipped = existingIds.size;
  let errors = 0;

  const allNew = [
    ...newReplied.map((a) => ({ activity: a, direction: "INBOUND" as const })),
    ...newSent.map((a) => ({ activity: a, direction: "OUTBOUND" as const })),
  ];

  await updateSyncProgress(integrationId, {
    stage: "processing",
    message: `Processing ${allNew.length} new messages`,
    total: allNew.length,
    current: 0,
    percent: allNew.length > 0 ? 40 : 100,
  });

  for (const { activity, direction } of allNew) {
    if (Date.now() - startTime > timeBudgetMs * 0.9) {
      console.log(`[lemlist-sync] Time budget hit during processing`);
      break;
    }

    const prospectEmail = activity.leadEmail || activity.email || (direction === "INBOUND" ? activity.fromEmail : undefined);
    if (!prospectEmail) {
      console.warn(`[lemlist-sync] Skipping activity ${activity._id} (${activity.type}) — no prospectEmail. Fields: leadEmail=${activity.leadEmail}, email=${activity.email}, fromEmail=${activity.fromEmail}`);
      skipped++;
      continue;
    }

    try {
      const bodyFromMcp = direction === "INBOUND" ? bodyMap.get(activity._id) : undefined;
      const payload = activityToPayload(activity, bodyFromMcp, campaignMap, direction);
      await resolveThread(workspaceId, integrationId, payload);
      synced++;

      // Back-write Prospect fields for inbound replies — mirrors Instantly sync behavior.
      // campaignName is required for threads to route to the main Inbox (not Outbound Inbox).
      // stepReplied + notes only set if still null (never overwrite manually-entered data).
      if (direction === "INBOUND" && prospectEmail) {
        const firstReplyUpdate: Record<string, string> = {};
        if (payload.campaignName) firstReplyUpdate.campaignName = payload.campaignName;
        firstReplyUpdate.stepReplied = "Step 1";
        if (Object.keys(firstReplyUpdate).length > 0) {
          await prisma.prospect.updateMany({
            where: { workspaceId, email: prospectEmail, stepReplied: null },
            data: firstReplyUpdate,
          });
        }
        const replyText = payload.messageText || payload.bodyText;
        if (replyText) {
          await prisma.prospect.updateMany({
            where: { workspaceId, email: prospectEmail, notes: null },
            data: { notes: replyText.slice(0, 500) },
          });
        }
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(
          `[lemlist-sync] Error processing activity ${activity._id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    if (synced > 0 && synced % 25 === 0) {
      await updateSyncProgress(integrationId, {
        stage: "processing",
        message: `Processed ${synced}/${allNew.length} messages`,
        current: synced,
        total: allNew.length,
        percent: Math.floor(40 + (synced / allNew.length) * 55),
      });
    }
  }

  // Save updated config
  const freshRow = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });
  const freshConfig = ((freshRow?.config as Record<string, unknown>) ?? {});
  if (config.lemlistBackfillComplete) {
    freshConfig.lemlistBackfillComplete = true;
  }

  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: freshConfig as object, lastSyncAt: new Date() },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(
    `[lemlist-sync] Done in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors`
  );

  await updateSyncProgress(integrationId, {
    stage: "done",
    message: `Synced ${synced} new messages`,
    percent: 100,
  });

  return { synced, skipped, errors };
}

export async function testLemlistConnection(apiKey: string): Promise<boolean> {
  try {
    const url = new URL(`${LEMLIST_API_BASE}/campaigns`);
    url.searchParams.set("access_token", apiKey);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString());
    return res.ok;
  } catch {
    return false;
  }
}
