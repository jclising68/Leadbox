import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const url = req.nextUrl;
  const status = url.searchParams.get("status") || "OPEN";
  const labelId = url.searchParams.get("labelId");
  const channel = url.searchParams.get("channel");
  const isUnread = url.searchParams.get("isUnread");
  const search = url.searchParams.get("search");
  const cursor = url.searchParams.get("cursor");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const hasReply = url.searchParams.get("hasReply");
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  const where: Prisma.ThreadWhereInput = {
    workspaceId: workspaceId!,
  };

  if (status && status !== "ALL") {
    where.status = status as Prisma.EnumThreadStatusFilter;
  }

  if (labelId) {
    where.threadLabels = { some: { labelId } };
  }

  if (isUnread === "true") {
    where.isUnread = true;
  }

  // Date range: match threads that have ANY message in the window, not just
  // the most recent one. A thread with a Mar 27 reply + Apr 6 reply should
  // appear when the user filters "March" — matching what they see in
  // Instantly/HeyReach Unibox. Filtering on Thread.lastMessageAt would have
  // hidden it because its *last* activity is April.
  const messageDateRange: { gte?: Date; lte?: Date } | null =
    dateFrom || dateTo ? {} : null;
  if (messageDateRange) {
    if (dateFrom) messageDateRange.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      messageDateRange.lte = end;
    }
  }

  const messageConditions: Prisma.MessageWhereInput[] = [];
  // Filter at the *message* level, not `Thread.channel`. Thread.channel is
  // captured once at thread creation and never updated, so a prospect first
  // seen via HeyReach keeps channel=LINKEDIN forever — their later Instantly
  // emails were invisible under the Email tab. Multi-channel threads now
  // correctly appear under whichever channels they have activity on.
  if (channel) {
    messageConditions.push({ channel: channel as "EMAIL" | "LINKEDIN" });
  }
  if (hasReply === "true") {
    messageConditions.push({ direction: "INBOUND" });
  }
  if (messageDateRange) {
    // `sentAt` is the provider timestamp; fall back to `receivedAt` (ingest
    // time) when sentAt is null, so messages without a provider timestamp
    // still match filters.
    messageConditions.push({
      OR: [
        { sentAt: messageDateRange },
        { AND: [{ sentAt: null }, { receivedAt: messageDateRange }] },
      ],
    });
  }
  if (messageConditions.length > 0) {
    where.messages = { some: { AND: messageConditions } };
  }

  const andConditions: Prisma.ThreadWhereInput[] = [];

  // Default inbox view ("All messages" tab, OPEN status, no label selected):
  // only show threads the prospect actually engaged with — has an INBOUND
  // message OR has any tag/label applied. Sent-only threads with no reply or
  // label are outbound-in-flight and belong in the leads tracker, not inbox.
  // Label-tab clicks, Archive, Spam, Trash, and ALL views skip this filter.
  if (!labelId && (status === "OPEN" || !status)) {
    andConditions.push({
      OR: [
        { messages: { some: { direction: "INBOUND" } } },
        { threadLabels: { some: {} } },
      ],
    });
  }

  if (search) {
    // Search on prospect fields and thread snippet only.
    // Full-text search on message body (bodyText/messageText) was removed
    // because ILIKE '%term%' on large text columns causes sequential scans.
    // TODO: Add pg_trgm GIN indexes or Supabase FTS for message body search.
    andConditions.push({
      OR: [
        { snippet: { contains: search, mode: "insensitive" } },
        {
          prospect: {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { company: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const threads = await prisma.thread.findMany({
    where,
    include: {
      prospect: true,
      threadLabels: { include: { label: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: sortDir },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = threads.length > limit;
  const data = hasMore ? threads.slice(0, limit) : threads;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return workspaceJson({ threads: data, nextCursor, hasMore });
}
