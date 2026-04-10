import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import type { Prisma } from "@prisma/client";

export async function PATCH(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const body = await req.json();
  const { id, notes, feedback, leadStatus } = body as {
    id?: string;
    notes?: string;
    feedback?: string;
    leadStatus?: string;
  };

  if (!id) {
    return NextResponse.json({ error: "Missing prospect id" }, { status: 400 });
  }

  // Only allow updating notes, feedback, and leadStatus
  const data: Prisma.ProspectUpdateInput = {};
  if (notes !== undefined) data.notes = notes;
  if (feedback !== undefined) data.feedback = feedback;
  if (leadStatus !== undefined) data.leadStatus = leadStatus || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Ensure the prospect belongs to this workspace
  const prospect = await prisma.prospect.findFirst({
    where: { id, workspaceId: workspaceId! },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  const updated = await prisma.prospect.update({
    where: { id },
    data,
  });

  return NextResponse.json({ prospect: updated });
}

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const url = req.nextUrl;
  const search = url.searchParams.get("search");
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);
  const sortBy = url.searchParams.get("sortBy") || "lastMessageAt";
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const labelFilter = url.searchParams.get("label");
  const channelFilter = url.searchParams.get("channel");
  const domainFilter = url.searchParams.get("domain");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const hasReply = url.searchParams.get("hasReply");
  const leadStatusFilter = url.searchParams.get("leadStatus");

  const where: Prisma.ProspectWhereInput = {
    workspaceId: workspaceId!,
  };

  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { company: { contains: search, mode: "insensitive" } },
      { domain: { contains: search, mode: "insensitive" } },
    ];
  }

  if (domainFilter) {
    where.domain = domainFilter;
  }

  if (channelFilter) {
    where.thread = { channel: channelFilter as "EMAIL" | "LINKEDIN" };
  }

  if (labelFilter) {
    where.thread = {
      ...where.thread as Prisma.ThreadWhereInput,
      threadLabels: { some: { label: { name: labelFilter } } },
    };
  }

  // Only show leads that have at least one inbound message (lead replied)
  if (hasReply === "true") {
    where.thread = {
      ...where.thread as Prisma.ThreadWhereInput,
      messages: { some: { direction: "INBOUND" } },
    };
    // Also exclude non-actionable campaign statuses (only show tagged/replied leads)
    where.NOT = {
      leadStatus: {
        in: [
          "In Sequence", "in sequence",
          "Completed", "completed",
          "Not Yet Contacted", "not yet contacted",
          "In Progress", "in progress",
          "Paused", "paused",
        ],
      },
    };
  }

  // Filter by specific lead status value
  if (leadStatusFilter) {
    where.leadStatus = { equals: leadStatusFilter, mode: "insensitive" };
  }

  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo + "T23:59:59.999Z");
    where.thread = {
      ...where.thread as Prisma.ThreadWhereInput,
      lastMessageAt: dateFilter,
    };
  }

  // Build orderBy
  const validSortFields: Record<string, Prisma.ProspectOrderByWithRelationInput> = {
    lastMessageAt: { thread: { lastMessageAt: sortDir } },
    updatedAt: { updatedAt: sortDir },
    createdAt: { createdAt: sortDir },
    sourceDate: { sourceDate: sortDir },
    email: { email: sortDir },
    firstName: { firstName: sortDir },
    company: { company: sortDir },
    domain: { domain: sortDir },
  };
  const orderBy = validSortFields[sortBy] || { thread: { lastMessageAt: "desc" } };

  const prospects = await prisma.prospect.findMany({
    where,
    include: {
      thread: {
        select: {
          id: true,
          channel: true,
          status: true,
          lastMessageAt: true,
          messageCount: true,
          isUnread: true,
          threadLabels: {
            include: { label: { select: { id: true, name: true, color: true } } },
          },
          messages: {
            take: 1,
            orderBy: { receivedAt: "desc" },
            select: {
              campaignName: true,
              integration: { select: { provider: true } },
            },
          },
        },
      },
    },
    orderBy,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = prospects.length > limit;
  const data = hasMore ? prospects.slice(0, limit) : prospects;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  const res = NextResponse.json({ prospects: data, nextCursor, hasMore });
  res.headers.set("Cache-Control", "private, max-age=5, stale-while-revalidate=10");
  return res;
}
