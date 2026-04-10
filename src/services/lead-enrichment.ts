import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const MIN_REQUEST_GAP_MS = 3500;

let lastRequestTime = 0;

// Instantly lt_interest_status mapping
const INTEREST_STATUS_MAP: Record<number, string> = {
  0: "Not Interested",
  1: "Interested",
  2: "Meeting Booked",
  3: "Meeting Completed",
  4: "Closed",
  5: "Out of Office",
  6: "Wrong Person",
  7: "Auto Reply",
  8: "Not the right time",
};

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

async function rateLimitedPost(apiKey: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestTime = Date.now();

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
      lastRequestTime = Date.now();
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
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestTime = Date.now();

  const url = new URL(`${INSTANTLY_API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 429) {
      const wait = Math.min(10000 * Math.pow(2, attempt), 120000);
      await new Promise((r) => setTimeout(r, wait));
      lastRequestTime = Date.now();
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
  lt_interest_status?: number;
  status?: number;
  campaign?: string;
  payload?: Record<string, unknown>;
  email_reply_count?: number;
  email_opened_step?: number;
  timestamp_created?: string;
  timestamp_last_contact?: string;
};

export async function enrichFromInstantly(integrationId: string): Promise<{
  enriched: number;
  campaigns: number;
  errors: number;
}> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });

  const apiKey = decrypt(integration.apiKeyEncrypted, integration.apiKeyIv, integration.apiKeyTag);
  const workspaceId = integration.workspaceId;

  console.log(`[enrich] Starting enrichment for integration ${integrationId}`);

  // 1. Get all campaigns
  const campaignData = await rateLimitedGet(apiKey, "/campaigns", { limit: "100" });
  const campaigns = (campaignData.items || []) as { id: string; name: string }[];
  console.log(`[enrich] Found ${campaigns.length} campaigns`);

  const campaignNameMap = new Map<string, string>();
  for (const c of campaigns) campaignNameMap.set(c.id, c.name);

  let enriched = 0;
  let errors = 0;

  // 2. For each campaign, fetch all leads
  for (const campaign of campaigns) {
    let startingAfter: string | undefined;

    while (true) {
      try {
        const body: Record<string, unknown> = {
          campaign_id: campaign.id,
          limit: 100,
        };
        if (startingAfter) body.starting_after = startingAfter;

        const data = await rateLimitedPost(apiKey, "/leads/list", body);
        const leads = (data.items || []) as InstantlyLead[];

        if (leads.length === 0) break;

        // Batch update prospects
        for (const lead of leads) {
          if (!lead.email) continue;

          try {
            // Map interest status (takes priority) or fallback to campaign status
            const interestLabel = (lead.lt_interest_status !== undefined && lead.lt_interest_status >= 0)
              ? INTEREST_STATUS_MAP[lead.lt_interest_status]
              : undefined;
            const statusLabel = interestLabel || getCampaignStatus(lead.status, lead.email_reply_count);

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
            updateData.campaignName = campaign.name;
            if (stepReplied) updateData.stepReplied = stepReplied;

            // Save original date from Instantly
            if (lead.timestamp_created) {
              updateData.sourceDate = new Date(lead.timestamp_created);
            }

            // Extract title from payload if available
            const payload = lead.payload || {};
            if (payload.title || payload.Title || payload.jobTitle || payload.job_title) {
              updateData.title = (payload.title || payload.Title || payload.jobTitle || payload.job_title) as string;
            }
            if (payload.phone || payload.Phone || payload.phoneNumber) {
              updateData.phone = updateData.phone || (payload.phone || payload.Phone || payload.phoneNumber) as string;
            }

            // Populate notes with lead's latest reply text
            const prospect = await prisma.prospect.findUnique({
              where: { workspaceId_email: { workspaceId, email: lead.email } },
              select: {
                id: true,
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

            // Set notes to latest reply if not already set
            if (prospect && !prospect.notes) {
              const latestReply = prospect.thread?.messages?.[0];
              if (latestReply) {
                const replyText = latestReply.bodyText || latestReply.messageText;
                if (replyText) {
                  updateData.notes = replyText.slice(0, 500);
                }
              }
            }

            // Only update if we have something new
            if (Object.keys(updateData).length > 0) {
              await prisma.prospect.update({
                where: { workspaceId_email: { workspaceId, email: lead.email } },
                data: updateData,
              });
              enriched++;
            }

            // Also apply the lead status as a label if it exists
            if (interestLabel) {
              const prospect = await prisma.prospect.findUnique({
                where: { workspaceId_email: { workspaceId, email: lead.email } },
                select: { thread: { select: { id: true } } },
              });
              if (prospect?.thread) {
                const label = await prisma.label.findFirst({
                  where: { workspaceId, name: interestLabel },
                });
                if (label) {
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
            }
          } catch {
            errors++;
          }
        }

        startingAfter = (data.next_starting_after as string) || undefined;
        if (!startingAfter || leads.length < 100) break;
      } catch (err) {
        console.error(`[enrich] Error fetching leads for campaign ${campaign.name}:`, err instanceof Error ? err.message : err);
        errors++;
        break;
      }
    }
  }

  console.log(`[enrich] Done: ${enriched} enriched, ${campaigns.length} campaigns, ${errors} errors`);
  return { enriched, campaigns: campaigns.length, errors };
}
