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

  // Channel + date use Thread-level fields so the filter matches exactly what
  // the user sees in the row (channel icon + DATE column, both thread-level).
  //
  // Earlier versions filtered at message level to support multi-channel
  // threads. That approach had a worse failure mode: a HeyReach thread with
  // one stray Email stub message would appear under the Email filter showing
  // an April date — confusing because the row icon and date both say "LinkedIn
  // April" but the filter is Email Jan-Mar. Thread-level filtering matches
  // user intent (the icon/date they see). Multi-channel continuity is
  // preserved by updating Thread.channel in thread-resolver whenever a newer
  // message of a different channel arrives, so the thread's primary channel
  // follows the most recent activity.
  if (channel) {
    where.channel = channel as "EMAIL" | "LINKEDIN";
  }
  if (dateFrom || dateTo) {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.lastMessageAt = dateFilter;
  }

  // hasReply stays message-level — it's a true existence check (does this
  // thread have any inbound message?) independent of channel/date framing.
  if (hasReply === "true") {
    where.messages = { some: { direction: "INBOUND" } };
  }

  const andConditions: Prisma.ThreadWhereInput[] = [];

  // Default inbox view ("All messages" tab, OPEN status, no label selected):
  // only show threads where the prospect actually replied (has an INBOUND message).
  // Sent-only threads belong in the leads tracker, not inbox.
  // Label-tab clicks, Archive, Spam, Trash, and ALL views skip this filter.
  if (!labelId && (status === "OPEN" || !status)) {
    andConditions.push({
      messages: { some: { direction: "INBOUND" } },
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
