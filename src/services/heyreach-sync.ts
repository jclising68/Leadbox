import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import { updateSyncProgress } from "@/services/sync-progress";
import type { NormalizedWebhookPayload } from "@/types";

// Correct HeyReach API base URL (ABP framework, public API)
const HEYREACH_API_BASE = "https://api.heyreach.io/api/public";
const BATCH_SIZE = 50;

// Default color for auto-created HeyReach tag labels.
// Mirrors known statuses to colors; unknown tags get a neutral violet.
function heyreachTagColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("interested") && !n.includes("not")) return "#22C55E";
  if (n.includes("not interested")) return "#EF4444";
  if (n.includes("meeting")) return "#3B82F6";
  if (n.includes("out of office")) return "#6B7280";
  if (n.includes("wrong person")) return "#F97316";
  if (n.includes("auto reply")) return "#EC4899";
  if (n.includes("future")) return "#EAB308";
  return "#8B5CF6";
}

// --- Types based on actual HeyReach API response ---

type HeyReachProfile = {
  linkedin_id?: string;
  profileUrl?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  companyName?: string;
  companyUrl?: string;
  position?: string;
  emailAddress?: string;
  customEmailAddress?: string;
  location?: string;
  tags?: string[];
};

type HeyReachMessageItem = {
  createdAt?: string;
  body?: string;
  subject?: string;
  sender?: string; // "ME" | "CORRESPONDENT"
  isInMail?: boolean;
};

type HeyReachConversation = {
  id?: string;
  read?: boolean;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastMessageSender?: string;
  totalMessages?: number;
  linkedInAccountId?: number;
  correspondentProfile?: HeyReachProfile;
  linkedInAccount?: {
    id?: number;
    emailAddress?: string;
    firstName?: string;
    lastName?: string;
    profileUrl?: string;
  };
  messages?: HeyReachMessageItem[];
};

type HeyReachCampaign = {
  id: number;
  name: string;
  status?: string;
};

type HeyReachCampaignLead = {
  id?: number;
  linkedInUserProfile?: HeyReachProfile;
  leadCampaignStatus?: string;
  leadConnectionStatus?: string;
  leadMessageStatus?: string;
  creationTime?: string;
  lastActionTime?: string;
};

// --- API helper ---

async function heyreachPost(apiKey: string, path: string, body: Record<string, unknown>) {
  const url = `${HEYREACH_API_BASE}${path}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Retry on rate limit or server errors
    if (res.status === 429 || (res.status >= 500 && attempt < 3)) {
      const wait = Math.min(3000 * Math.pow(2, attempt), 30000);
      console.log(`[heyreach] ${res.status} on ${path}, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/4)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HeyReach POST ${path} ${res.status}: ${text}`);
    }

    return res.json();
  }

  throw new Error(`HeyReach POST ${path} failed after 4 retries`);
}

// --- Data fetching ---

async function fetchCampaigns(apiKey: string): Promise<HeyReachCampaign[]> {
  const all: HeyReachCampaign[] = [];
  let offset = 0;

  while (true) {
    const data = await heyreachPost(apiKey, "/Campaign/GetAll", { offset, limit: 100 });
    const items = (data.items || []) as HeyReachCampaign[];
    if (items.length === 0) break;
    all.push(...items);
    offset += items.length;
    if (all.length >= (data.totalCount || 0)) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[heyreach] Found ${all.length} campaigns`);
  return all;
}

async function fetchConversationsIncremental(
  integrationId: string,
  apiKey: string,
  lastSyncAt: Date | null,
  timeBudgetMs: number,
  startTime: number,
): Promise<{ conversations: HeyReachConversation[]; exhausted: boolean }> {
  const all: HeyReachConversation[] = [];
  let offset = 0;
  let exhausted = true;
  let page = 0;

  while (true) {
    // Time-budget: leave half for processing
    if (Date.now() - startTime > timeBudgetMs * 0.4) {
      console.log(`[heyreach] Fetch phase hit 40% time budget after ${all.length} conversations`);
      exhausted = false;
      break;
    }

    page++;
    await updateSyncProgress(integrationId, {
      stage: "fetching_conversations",
      message: `Fetching conversations page ${page} (${all.length} so far)`,
      current: page,
      percent: Math.min(10 + page * 5, 55),
    });

    const data = await heyreachPost(apiKey, "/Inbox/GetConversationsV2", {
      offset,
      limit: BATCH_SIZE,
    });

    const items = (data.items || []) as HeyReachConversation[];
    if (items.length === 0) break;

    all.push(...items);
    offset += items.length;

    const total = data.totalCount || 0;
    console.log(`[heyreach] Fetched ${all.length}/${total} conversations...`);

    // Early termination: if we have a lastSyncAt and all conversations
    // in this page were last active before our last sync, stop.
    if (lastSyncAt && items.length > 0) {
      const staleCount = items.filter((c) => {
        const lastMsg = c.lastMessageAt ? new Date(c.lastMessageAt) : null;
        return lastMsg && lastMsg < lastSyncAt;
      }).length;

      if (staleCount === items.length && all.length > BATCH_SIZE) {
        console.log(`[heyreach] Early termination: page is entirely older than last sync`);
        break;
      }
    }

    // Rely on the server's totalCount for end-of-history; a short page
    // alone can happen mid-walk if HeyReach trims a response, and breaking
    // on it would leave older conversations unsynced.
    if (total > 0 && all.length >= total) break;
    if (total === 0 && items.length < BATCH_SIZE) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  return { conversations: all, exhausted };
}

// Fetch the up-to-date tag set for one lead. HeyReach's conversation
// endpoint *claims* to include `correspondentProfile.tags` but in practice
// always returns an empty array, so user-applied tags weren't reaching the
// inbox. `/lead/GetTags` is the source of truth (confirmed against the
// production API — see scripts/tests/test-heyreach-tags-path.ts).
async function fetchTagsForLead(
  apiKey: string,
  profileUrl: string,
): Promise<string[]> {
  try {
    const data = (await heyreachPost(apiKey, "/lead/GetTags", {
      profileUrl,
    })) as { tags?: string[] };
    return data.tags ?? [];
  } catch (err) {
    // Non-fatal — tag fetch missing shouldn't block enrichment of everything
    // else. Single-lead 404s happen when HeyReach hasn't indexed a very new
    // conversation yet.
    console.log(
      `[heyreach] GetTags failed for ${profileUrl}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function fetchLeadsFromCampaign(
  apiKey: string,
  campaignId: number
): Promise<HeyReachCampaignLead[]> {
  const all: HeyReachCampaignLead[] = [];
  let offset = 0;

  while (true) {
    try {
      const data = await heyreachPost(apiKey, "/Campaign/GetLeadsFromCampaign", {
        campaignId,
        offset,
        limit: 100,
      });

      const items = (data.items || []) as HeyReachCampaignLead[];
      if (items.length === 0) break;

      all.push(...items);
      offset += items.length;

      if (all.length >= (data.totalCount || 0)) break;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.log(`[heyreach] Error fetching leads for campaign ${campaignId}:`, err instanceof Error ? err.message : err);
      break;
    }
  }

  return all;
}

// --- Main sync ---

export async function syncHeyreach(
  integrationId: string,
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

  console.log(`[heyreach] Starting sync for integration ${integrationId}`);
  await updateSyncProgress(integrationId, {
    stage: "starting",
    message: "Starting HeyReach sync",
    percent: 2,
  });

  // 1. Fetch campaigns and conversations (with incremental awareness)
  await updateSyncProgress(integrationId, {
    stage: "fetching_campaigns",
    message: "Loading campaigns",
    percent: 5,
  });
  const campaigns = await fetchCampaigns(apiKey);
  const { conversations } = await fetchConversationsIncremental(
    integrationId, apiKey, integration.lastSyncAt, timeBudgetMs, startTime,
  );

  console.log(`[heyreach] Processing ${conversations.length} conversations...`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // 2. Flatten all messages, sorted chronologically
  const allPayloads: NormalizedWebhookPayload[] = [];
  for (const conv of conversations) {
    const profile = conv.correspondentProfile;
    if (!profile) continue;

    const messages = conv.messages || [];
    if (messages.length === 0) continue;

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
      const msg = messages[msgIdx];
      const isOutbound = msg.sender === "ME";
      // Use a stable identifier: conversation ID + createdAt + index within conversation.
      // The index prevents collisions when multiple messages share the same createdAt.
      // Never use Date.now() — it changes between sync runs and defeats deduplication.
      const externalId = `hr_${conv.id}_${msg.createdAt || `idx_${msgIdx}`}`;

      allPayloads.push({
        provider: "HEYREACH",
        eventType: isOutbound ? "MESSAGE_SENT" : "MESSAGE_REPLY_RECEIVED",
        direction: isOutbound ? "OUTBOUND" : "INBOUND",
        channel: "LINKEDIN",
        prospectEmail: profile.emailAddress || profile.customEmailAddress,
        prospectLinkedinUrl: profile.profileUrl,
        prospectFirstName: profile.firstName,
        prospectLastName: profile.lastName,
        prospectCompany: profile.companyName,
        messageText: msg.body,
        externalId,
        sentAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
        rawPayload: {
          conversationId: conv.id,
          linkedInAccountId: conv.linkedInAccountId,
          linkedInAccount: conv.linkedInAccount,
          message: msg,
        } as unknown as Record<string, unknown>,
      });
    }
  }

  // Sort newest-first so recent data appears immediately
  allPayloads.sort((a, b) => (b.sentAt?.getTime() || 0) - (a.sentAt?.getTime() || 0));
  console.log(`[heyreach] Processing ${allPayloads.length} messages...`);

  // 2b. Batch dedup — fetch existing externalIds from recent messages only.
  // Limiting to last 90 days avoids loading the entire message table into memory.
  const dedupCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const existingIds = new Set(
    (await prisma.message.findMany({
      where: {
        workspaceId,
        externalId: { not: null, startsWith: "hr_" },
        receivedAt: { gte: dedupCutoff },
      },
      select: { externalId: true },
    })).map((m) => m.externalId).filter(Boolean)
  );
  const newPayloads = allPayloads.filter(
    (p) => p.externalId && !existingIds.has(p.externalId) && (p.prospectLinkedinUrl || p.prospectEmail)
  );
  const alreadySynced = allPayloads.length - newPayloads.length;
  console.log(`[heyreach] ${alreadySynced} already synced, ${newPayloads.length} new messages to process`);
  skipped += alreadySynced;

  await updateSyncProgress(integrationId, {
    stage: "processing",
    message: `Processing ${newPayloads.length} new messages`,
    total: newPayloads.length,
    current: 0,
    percent: 60,
  });

  // 3. Sync only NEW messages to threads
  for (let i = 0; i < newPayloads.length; i += 20) {
    // Time-budget check
    if (Date.now() - startTime > timeBudgetMs * 0.7) {
      console.log(`[heyreach] Time budget 70% reached during processing, ${newPayloads.length - i} messages deferred`);
      break;
    }

    const batch = newPayloads.slice(i, i + 20);
    await Promise.allSettled(
      batch.map(async (payload) => {
        try {
          await resolveThread(workspaceId, integrationId, payload);
          synced++;
        } catch {
          errors++;
        }
      })
    );

    if (synced > 0 && i % 40 === 0) {
      await updateSyncProgress(integrationId, {
        stage: "processing",
        message: `Processed ${synced}/${newPayloads.length} messages`,
        current: synced,
        total: newPayloads.length,
        percent: Math.min(
          60 + Math.floor((synced / Math.max(newPayloads.length, 1)) * 30),
          89,
        ),
      });
    }

    if (i + 20 < newPayloads.length) await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[heyreach] Messages synced: ${synced} synced, ${skipped} skipped, ${errors} errors`);

  // 4. Enrich prospects from conversation profiles + campaign data
  // Skip enrichment if we've used >80% of time budget — it'll run next cycle
  if (Date.now() - startTime > timeBudgetMs * 0.8) {
    console.log(`[heyreach] Skipping enrichment — time budget ${Math.round((Date.now() - startTime) / 1000)}s, will enrich next cycle`);
    await updateSyncProgress(integrationId, {
      stage: "finalizing",
      message: "Finalizing (enrichment deferred)",
      percent: 95,
    });
    await prisma.integration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date() },
    });
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[heyreach] Sync complete in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors (enrichment deferred)`);
    await updateSyncProgress(integrationId, {
      stage: "done",
      message: `Synced ${synced} new messages (enrichment deferred)`,
      percent: 100,
    });
    return { synced, skipped, errors };
  }

  await updateSyncProgress(integrationId, {
    stage: "enriching",
    message: `Enriching prospects from ${conversations.length} conversations`,
    percent: 90,
  });
  console.log(`[heyreach] Enriching prospects from ${conversations.length} conversations...`);

  // Build profileUrl → campaign name mapping from all campaigns
  const profileCampaignMap = new Map<string, { campaignName: string; status: string }>();

  for (const campaign of campaigns) {
    // Time-budget check inside campaign loop
    if (Date.now() - startTime > timeBudgetMs * 0.9) {
      console.log(`[heyreach] Enrichment time budget reached, ${campaigns.length - campaigns.indexOf(campaign)} campaigns deferred`);
      break;
    }

    try {
      const leads = await fetchLeadsFromCampaign(apiKey, campaign.id);
      for (const lead of leads) {
        const profileUrl = lead.linkedInUserProfile?.profileUrl;
        if (profileUrl) {
          // Keep the most recent campaign (or first one found)
          if (!profileCampaignMap.has(profileUrl)) {
            profileCampaignMap.set(profileUrl, {
              campaignName: campaign.name,
              status: lead.leadCampaignStatus || "Lead",
            });
          }
        }
      }
      console.log(`[heyreach] Fetched ${leads.length} leads from campaign "${campaign.name}"`);
    } catch (err) {
      console.log(`[heyreach] Skipping campaign ${campaign.name}:`, err instanceof Error ? err.message : err);
    }
  }

  // Enrich each prospect from conversation profiles
  let enriched = 0;
  let taggedApplied = 0;
  for (const conv of conversations) {
    const profile = conv.correspondentProfile;
    if (!profile?.profileUrl) continue;

    // Soft enrichment time budget — stop the expensive per-lead tag fetch
    // once we're near the function timeout; remaining leads pick up next run.
    if (Date.now() - startTime > timeBudgetMs * 0.9) {
      console.log(`[heyreach] Enrichment time budget exhausted at conv, remaining prospects deferred to next sync`);
      break;
    }

    try {
      const updateData: Record<string, unknown> = {};

      // Profile data
      if (profile.companyName) updateData.company = profile.companyName;
      if (profile.position) updateData.title = profile.position;
      if (profile.emailAddress || profile.customEmailAddress) {
        updateData.email = profile.emailAddress || profile.customEmailAddress;
      }

      // Domain from email
      const email = profile.emailAddress || profile.customEmailAddress;
      if (email && email.includes("@")) {
        updateData.domain = email.split("@")[1];
      }

      // Pull the authoritative tag set from /lead/GetTags. Merge with any
      // tags already embedded in the conversation profile (defensive — the
      // embedded list is usually empty but costs nothing to combine).
      const fetchedTags = await fetchTagsForLead(apiKey, profile.profileUrl);
      await new Promise((r) => setTimeout(r, 200));
      const allTags = Array.from(
        new Set([...(profile.tags ?? []), ...fetchedTags].map((t) => t.trim()).filter(Boolean)),
      );

      // Lead status from tags (e.g. "Meeting booked", "Interested")
      if (allTags.length > 0) {
        updateData.leadStatus = allTags[0];
      }

      // Campaign info from leads-per-campaign data
      const campaignInfo = profileCampaignMap.get(profile.profileUrl);
      if (campaignInfo) {
        updateData.campaignName = campaignInfo.campaignName;
        // If no tag-based status, use campaign status
        if (!updateData.leadStatus) {
          updateData.leadStatus = campaignInfo.status;
        }
      }

      // Step replied - HeyReach defaults to Step 1 if there's a reply
      const messages = conv.messages || [];
      const hasReply = messages.some((m) => m.sender === "CORRESPONDENT");
      if (hasReply) {
        updateData.stepReplied = "Step 1";
      }

      // Source date from earliest message
      if (messages.length > 0) {
        const earliest = messages.reduce((a, b) =>
          (a.createdAt || "") < (b.createdAt || "") ? a : b
        );
        if (earliest.createdAt) {
          updateData.sourceDate = new Date(earliest.createdAt);
        }
      }

      // Notes - latest reply from the correspondent
      const replies = messages.filter((m) => m.sender === "CORRESPONDENT");
      if (replies.length > 0) {
        const latestReply = replies[replies.length - 1];
        if (latestReply.body) {
          updateData.notes = latestReply.body.slice(0, 500);
        }
      }

      if (Object.keys(updateData).length > 0 && profile.profileUrl) {
        // Use updateMany to avoid "Record not found" errors — the prospect
        // may not exist yet if it was deferred to a future sync cycle.
        const result = await prisma.prospect.updateMany({
          where: { workspaceId, linkedinUrl: profile.profileUrl },
          data: updateData,
        });
        if (result.count > 0) enriched++;
      }

      // Apply tags as thread labels — auto-create the label if missing so
      // user-defined HeyReach tags surface in the inbox without manual setup.
      if (allTags.length > 0 && profile.profileUrl) {
        const prospect = await prisma.prospect.findFirst({
          where: { workspaceId, linkedinUrl: profile.profileUrl },
          select: { thread: { select: { id: true } } },
        });
        if (prospect?.thread) {
          for (const tag of allTags) {
            let label = await prisma.label.findFirst({
              where: { workspaceId, name: { equals: tag, mode: "insensitive" } },
              select: { id: true },
            });
            if (!label) {
              label = await prisma.label.upsert({
                where: { workspaceId_name: { workspaceId, name: tag } },
                create: { workspaceId, name: tag, color: heyreachTagColor(tag) },
                update: {},
                select: { id: true },
              });
            }
            await prisma.threadLabel.upsert({
              where: { threadId_labelId: { threadId: prospect.thread.id, labelId: label.id } },
              create: {
                threadId: prospect.thread.id,
                labelId: label.id,
                source: "WEBHOOK",
                confidence: 1.0,
              },
              update: {},
            });
          }
          taggedApplied++;
        }
      }
    } catch {
      // Non-critical enrichment error
    }
  }

  console.log(`[heyreach] Enriched ${enriched} prospects, applied tags to ${taggedApplied} threads`);

  await updateSyncProgress(integrationId, {
    stage: "finalizing",
    message: "Finalizing",
    percent: 95,
  });

  // 5. Update lastSyncAt
  await prisma.integration.update({
    where: { id: integrationId },
    data: { lastSyncAt: new Date() },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[heyreach] Sync complete in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${errors} errors`);
  await updateSyncProgress(integrationId, {
    stage: "done",
    message: `Synced ${synced} new messages`,
    percent: 100,
  });
  return { synced, skipped, errors };
}

// --- Connection test ---

export async function testHeyreachConnection(apiKey: string): Promise<boolean> {
  try {
    const data = await heyreachPost(apiKey, "/Campaign/GetAll", { offset: 0, limit: 1 });
    console.log(`[heyreach] Connection verified: ${data.totalCount} campaigns found`);
    return true;
  } catch (err) {
    console.error("[heyreach] Connection test failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
