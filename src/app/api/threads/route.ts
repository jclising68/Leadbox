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

  if (channel) {
    where.channel = channel as Prisma.EnumChannelFilter;
  }

  if (isUnread === "true") {
    where.isUnread = true;
  }

  if (dateFrom || dateTo) {
    const range: { gte?: Date; lte?: Date } = {};
    if (dateFrom) range.gte = new Date(dateFrom);
    if (dateTo) {
      // Make `dateTo` inclusive of the entire selected day.
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.lastMessageAt = range;
  }

  // Only show threads where the lead has replied (has INBOUND messages)
  if (hasReply === "true") {
    where.messages = { some: { direction: "INBOUND" } };
  }

  if (search) {
    // Search on prospect fields and thread snippet only.
    // Full-text search on message body (bodyText/messageText) was removed
    // because ILIKE '%term%' on large text columns causes sequential scans.
    // TODO: Add pg_trgm GIN indexes or Supabase FTS for message body search.
    where.OR = [
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
    ];
  }

  const threads = await prisma.thread.findMany({
    where,
    include: {
      prospect: true,
      threadLabels: { include: { label: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = threads.length > limit;
  const data = hasMore ? threads.slice(0, limit) : threads;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return workspaceJson({ threads: data, nextCursor, hasMore });
}
