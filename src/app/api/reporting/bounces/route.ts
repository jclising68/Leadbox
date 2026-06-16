import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { decrypt } from "@/lib/crypto";

function parseMonth(raw: string | null): { start: Date; end: Date } | null {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [year, month] = raw.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function groupByKey<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of arr) {
    const k = fn(item) || "Unknown";
    map[k] = (map[k] ?? 0) + 1;
  }
  return map;
}

async function generateInsight(
  apiKey: string,
  summary: { totalBounced: number; totalUnsubscribed: number },
  byCampaign: { name: string; count: number }[],
  byDomain: { domain: string; count: number }[],
): Promise<string[] | null> {
  try {
    const client = new Anthropic({ apiKey });
    const topCampaigns = byCampaign.slice(0, 3).map((c) => `${c.name} (${c.count})`).join(", ");
    const topDomains = byDomain.slice(0, 3).map((d) => `${d.domain} (${d.count})`).join(", ");

    const prompt = `You are an outbound sales deliverability advisor. Given this bounce/unsubscribe report, return exactly 2-3 short action items. Each action must be 1 sentence, specific, and actionable. Return only a JSON array of strings with no extra text.

Report:
- Bounced this period: ${summary.totalBounced}
- Unsubscribed this period: ${summary.totalUnsubscribed}
- Top affected campaigns: ${topCampaigns || "none"}
- Top affected domains: ${topDomains || "none"}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    // Strip markdown code fences if present
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.slice(0, 3);
    }
    console.error("[bounces] insight parse failed — unexpected shape:", text);
    return null;
  } catch (err) {
    console.error("[bounces] generateInsight failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const monthParam = req.nextUrl.searchParams.get("month");
  const now = new Date();
  const range = parseMonth(monthParam) ?? {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };

  const [bounced, unsubscribed] = await Promise.all([
    prisma.prospect.findMany({
      where: {
        workspaceId: workspaceId!,
        leadStatus: "Bounced",
        updatedAt: { gte: range.start, lte: range.end },
      },
      select: {
        email: true,
        company: true,
        domain: true,
        campaignName: true,
        updatedAt: true,
      },
    }),
    prisma.prospect.findMany({
      where: {
        workspaceId: workspaceId!,
        isUnsubscribed: true,
        unsubscribedAt: { gte: range.start, lte: range.end },
      },
      select: {
        email: true,
        company: true,
        domain: true,
        campaignName: true,
        unsubscribedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const allProspects = [
    ...bounced.map((p) => ({ ...p, reason: "Bounced" as const, date: p.updatedAt })),
    ...unsubscribed.map((p) => ({ ...p, reason: "Unsubscribed" as const, date: p.unsubscribedAt ?? p.updatedAt })),
  ];

  const campaignMap = groupByKey(allProspects, (p) => p.campaignName ?? "");
  const byCampaign = Object.entries(campaignMap)
    .filter(([k]) => k && k !== "Unknown")
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const domainMap = groupByKey(allProspects, (p) => {
    if (p.domain) return p.domain;
    if (p.email) return p.email.split("@")[1] ?? "";
    return "";
  });
  const byDomain = Object.entries(domainMap)
    .filter(([k]) => k && k !== "Unknown")
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  const leads = allProspects
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 50)
    .map((p) => ({
      email: p.email ?? "",
      company: p.company ?? "",
      campaign: p.campaignName ?? "",
      reason: p.reason,
      date: p.date?.toISOString() ?? null,
    }));

  const summary = {
    totalBounced: bounced.length,
    totalUnsubscribed: unsubscribed.length,
    total: allProspects.length,
  };

  // AI insight — only when there's something to act on
  let insight: string[] | null = null;
  if (summary.total > 0) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId! },
      select: { claudeKey: true, claudeKeyIv: true, claudeKeyTag: true },
    });
    const apiKey =
      workspace?.claudeKey && workspace.claudeKeyIv && workspace.claudeKeyTag
        ? decrypt(workspace.claudeKey, workspace.claudeKeyIv, workspace.claudeKeyTag)
        : process.env.ANTHROPIC_API_KEY ?? null;

    if (apiKey) {
      insight = await generateInsight(apiKey, summary, byCampaign, byDomain);
    }
  }

  return NextResponse.json({ summary, byCampaign, byDomain, leads, insight });
}
