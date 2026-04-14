import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { resolveThread } from "@/services/thread-resolver";
import type { NormalizedWebhookPayload } from "@/types";

// Correct HeyReach API base URL (ABP framework, public API)
const HEYREACH_API_BASE = "https://api.heyreach.io/api/public";
const BATCH_SIZE = 50;

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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach POST ${path} ${res.status}: ${text}`);
  }

  return res.json();
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

async function fetchAllConversations(apiKey: string): Promise<HeyReachConversation[]> {
  const all: HeyReachConversation[] = [];
  let offset = 0;

  while (true) {
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

    if (all.length >= total || items.length < BATCH_SIZE) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
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

export async function syncHeyreach(integrationId: string): Promise<{
  synced: number;
  skipped: number;
  errors: number;
}> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(integration.apiKeyEncrypted, integration.apiKeyIv, integration.apiKeyTag);
  const workspaceId = integration.workspaceId;

  console.log(`[heyreach] Starting sync for integration ${integrationId}`);

  // 1. Fetch campaigns and conversations
  const campaigns = await fetchCampaigns(apiKey);
  const conversations = await fetchAllConversations(apiKey);

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

    for (const msg of messages) {
      const isOutbound = msg.sender === "ME";
      const externalId = `hr_${conv.id}_${msg.createdAt || Date.now()}`;

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

  allPayloads.sort((a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0));
  console.log(`[heyreach] Processing ${allPayloads.length} messages...`);

  // 2b. Batch dedup — fetch all existing externalIds in ONE query to avoid
  // per-message DB round trips (each ~100ms to Supabase = minutes for 100+ msgs).
  const existingIds = new Set(
    (await prisma.message.findMany({
      where: { workspaceId, externalId: { not: null } },
      select: { externalId: true },
    })).map((m) => m.externalId).filter(Boolean)
  );
  const newPayloads = allPayloads.filter(
    (p) => p.externalId && !existingIds.has(p.externalId) && (p.prospectLinkedinUrl || p.prospectEmail)
  );
  const alreadySynced = allPayloads.length - newPayloads.length;
  console.log(`[heyreach] ${alreadySynced} already synced, ${newPayloads.length} new messages to process`);
  skipped += alreadySynced;

  // 3. Sync only NEW messages to threads
  for (let i = 0; i < newPayloads.length; i += 20) {
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
    if (i + 20 < newPayloads.length) await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[heyreach] Messages synced: ${synced} synced, ${skipped} skipped, ${errors} errors`);

  // 4. Enrich prospects from conversation profiles + campaign data
  console.log(`[heyreach] Enriching prospects from ${conversations.length} conversations...`);

  // Build profileUrl → campaign name mapping from all campaigns
  const profileCampaignMap = new Map<string, { campaignName: string; status: string }>();

  for (const campaign of campaigns) {
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
  for (const conv of conversations) {
    const profile = conv.correspondentProfile;
    if (!profile?.profileUrl) continue;

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

      // Lead status from tags (e.g. "Meeting booked", "Interested")
      if (profile.tags && profile.tags.length > 0) {
        updateData.leadStatus = profile.tags[0];
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
        await prisma.prospect.update({
          where: { workspaceId_linkedinUrl: { workspaceId, linkedinUrl: profile.profileUrl } },
          data: updateData,
        });
        enriched++;
      }

      // Apply tags as thread labels
      if (profile.tags && profile.tags.length > 0) {
        const prospect = await prisma.prospect.findUnique({
          where: { workspaceId_linkedinUrl: { workspaceId, linkedinUrl: profile.profileUrl } },
          select: { thread: { select: { id: true } } },
        });
        if (prospect?.thread) {
          for (const tag of profile.tags) {
            const label = await prisma.label.findFirst({
              where: { workspaceId, name: { equals: tag, mode: "insensitive" } },
            });
            if (label) {
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
          }
        }
      }
    } catch {
      // Non-critical enrichment error
    }
  }

  console.log(`[heyreach] Enriched ${enriched} prospects`);

  // 5. Update lastSyncAt
  await prisma.integration.update({
    where: { id: integrationId },
    data: { lastSyncAt: new Date() },
  });

  console.log(`[heyreach] Sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);
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
