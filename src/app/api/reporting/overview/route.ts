import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

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

export async function GET(req: NextRequest) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const monthParam = req.nextUrl.searchParams.get("month");
  const sourceParam = req.nextUrl.searchParams.get("source"); // "EMAIL" | "LINKEDIN" | null
  const labelParam = req.nextUrl.searchParams.get("label");   // label name | null

  const now = new Date();
  const range = parseMonth(monthParam) ?? {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };

  // Build optional channel filter for messages
  const channelWhere =
    sourceParam === "EMAIL" ? { channel: "EMAIL" as const } :
    sourceParam === "LINKEDIN" ? { channel: "LINKEDIN" as const } : {};

  // Build optional label filter for threads
  const labelWhere = labelParam
    ? { threadLabels: { some: { label: { name: labelParam } } } }
    : {};

  // ── 1. Reply volume per day ──────────────────────────────────────────────
  // Only count messages that came from a campaign:
  //   campaignId != null  → Instantly campaign reply (has the Instantly campaign UUID)
  //   prospect.campaignName != null → HeyReach/other provider campaign reply
  // This excludes system/notification emails (Google alerts, bounces, etc.)
  // that land in Instantly mailboxes but are not real lead replies.
  const campaignFilter = {
    OR: [
      { campaignId: { not: null } },
      { thread: { prospect: { campaignName: { not: null } } } },
    ],
  };

  const inboundMessages = await prisma.message.findMany({
    where: {
      workspaceId: workspaceId!,
      direction: "INBOUND",
      sentAt: { gte: range.start, lte: range.end },
      ...channelWhere,
      ...campaignFilter,
      ...(labelParam ? {
        thread: { threadLabels: { some: { label: { name: labelParam } } } },
      } : {}),
    },
    select: { sentAt: true },
  });

  const dayMap: Record<string, number> = {};
  for (const msg of inboundMessages) {
    if (!msg.sentAt) continue;
    const day = msg.sentAt.toISOString().slice(0, 10);
    dayMap[day] = (dayMap[day] ?? 0) + 1;
  }
  const replyVolume = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, replies]) => ({ date, replies }));

  // ── 2. Threads with ≥1 inbound reply ─────────────────────────────────────
  const replyThreads = await prisma.thread.findMany({
    where: {
      workspaceId: workspaceId!,
      ...labelWhere,
      messages: {
        some: {
          direction: "INBOUND",
          sentAt: { gte: range.start, lte: range.end },
          ...channelWhere,
          ...campaignFilter,
        },
      },
    },
    select: {
      prospect: {
        select: { campaignName: true, title: true, stepReplied: true },
      },
    },
  });

  const prospects = replyThreads.map((t) => t.prospect);

  const campaignMap = groupByKey(prospects, (p) => p.campaignName ?? "");
  const topCampaigns = Object.entries(campaignMap)
    .filter(([k]) => k && k !== "Unknown")
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, replies]) => ({ name, replies }));

  const titleMap = groupByKey(prospects, (p) => p.title ?? "");
  const topTitles = Object.entries(titleMap)
    .filter(([k]) => k && k !== "Unknown")
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([title, replies]) => ({ title, replies }));

  const stepMap = groupByKey(prospects, (p) => p.stepReplied ?? "");
  const stepPerformance = Object.entries(stepMap)
    .filter(([k]) => k && k !== "Unknown")
    .sort(([, a], [, b]) => b - a)
    .map(([step, replies]) => ({ step, replies }));

  // ── 3. Label distribution ─────────────────────────────────────────────────
  const labels = await prisma.label.findMany({
    where: { workspaceId: workspaceId! },
    select: {
      name: true,
      color: true,
      _count: { select: { threadLabels: true } },
    },
    orderBy: { threadLabels: { _count: "desc" } },
  });

  const labelDistribution = labels
    .filter((l) => l._count.threadLabels > 0)
    .map((l) => ({ label: l.name, count: l._count.threadLabels, color: l.color }));

  const totalReplies = inboundMessages.length;
  const topCampaign = topCampaigns[0]?.name ?? null;
  const topStep = stepPerformance[0]?.step ?? null;

  return NextResponse.json({
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    summary: { totalReplies, topCampaign, topStep },
    replyVolume,
    topCampaigns,
    topTitles,
    stepPerformance,
    labelDistribution,
  });
}
