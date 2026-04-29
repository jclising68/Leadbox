import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";
import { syncProviderTags } from "@/services/provider-tags";
import type { Prisma } from "@prisma/client";

export async function PATCH(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const body = await req.json();
  const { id, notes, feedback, leadStatus, campaignName } = body as {
    id?: string;
    notes?: string;
    feedback?: string;
    leadStatus?: string;
    campaignName?: string;
  };

  if (!id) {
    return NextResponse.json({ error: "Missing prospect id" }, { status: 400 });
  }

  // Only allow updating notes, feedback, leadStatus, and campaignName
  const data: Prisma.ProspectUpdateInput = {};
  if (notes !== undefined) data.notes = notes;
  if (feedback !== undefined) data.feedback = feedback;
  if (leadStatus !== undefined) data.leadStatus = leadStatus || null;
  if (campaignName !== undefined) data.campaignName = campaignName || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Ensure the prospect belongs to this workspace (include thread for tag sync)
  const prospect = await prisma.prospect.findFirst({
    where: { id, workspaceId: workspaceId! },
    include: { thread: { select: { id: true } } },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  const updated = await prisma.prospect.update({
    where: { id },
    data,
  });

  // When leadStatus changes, sync the tag to the thread (inbox) and provider
  let providerSync = null;
  if (leadStatus !== undefined && prospect.thread) {
    const threadId = prospect.thread.id;

    if (leadStatus) {
      // Find or verify the label exists in this workspace
      const label = await prisma.label.findFirst({
        where: {
          workspaceId: workspaceId!,
          name: { equals: leadStatus, mode: "insensitive" },
        },
      });

      if (label) {
        // Remove all existing MANUAL labels from this thread first
        const existingLabels = await prisma.threadLabel.findMany({
          where: { threadId, source: "MANUAL" },
          select: { id: true, labelId: true },
        });
        for (const tl of existingLabels) {
          if (tl.labelId !== label.id) {
            await prisma.threadLabel.delete({ where: { id: tl.id } });
          }
        }

        // Upsert the new label
        await prisma.threadLabel.upsert({
          where: { threadId_labelId: { threadId, labelId: label.id } },
          update: { source: "MANUAL", appliedAt: new Date() },
          create: { threadId, labelId: label.id, source: "MANUAL" },
        });
      }
    } else {
      // Clearing the status — remove all MANUAL labels
      await prisma.threadLabel.deleteMany({
        where: { threadId, source: "MANUAL" },
      });
    }

    // Push updated tags to Instantly/HeyReach
    providerSync = await syncProviderTags(workspaceId!, threadId);
  }

  return NextResponse.json({ prospect: updated, providerSync });
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
  const actionable = url.searchParams.get("actionable");
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

  // Channel uses Thread.channel so the filter matches the row's primary
  // channel (icon users see). Earlier message-level filtering caused stray
  // stub messages of one channel to drag a thread into the wrong filter. The
  // thread-resolver now updates Thread.channel on every new message so
  // multi-channel threads keep this field accurate.
  if (channelFilter) {
    where.thread = {
      ...(where.thread as Prisma.ThreadWhereInput),
      channel: channelFilter as "EMAIL" | "LINKEDIN",
    };
  }
  // hasReply stays message-level — pure existence check for an inbound message.
  if (hasReply === "true") {
    where.thread = {
      ...(where.thread as Prisma.ThreadWhereInput),
      messages: { some: { direction: "INBOUND" } },
    };
  }

  if (labelFilter) {
    where.thread = {
      ...where.thread as Prisma.ThreadWhereInput,
      threadLabels: { some: { label: { name: labelFilter } } },
    };
  }

  // Show only "actionable" leads: those that replied OR have tags from
  // Instantly/HeyReach. Uses precise data signals — no hardcoded status lists.
  //   1. Has INBOUND messages = lead replied
  //   2. Has WEBHOOK-source labels = tagged in Instantly/HeyReach
  //   3. stepReplied is set = enrichment confirmed reply from Instantly API
  if (actionable === "true") {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          // Lead replied (inbound message exists in thread)
          { thread: { messages: { some: { direction: "INBOUND" } } } },
          // Lead has been tagged in Instantly or HeyReach (WEBHOOK-source labels)
          { thread: { threadLabels: { some: { source: "WEBHOOK" } } } },
          // Enrichment confirmed reply via Instantly's email_reply_count
          { stepReplied: { not: null } },
        ],
      },
    ];
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
    lastName: { lastName: sortDir },
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

  return workspaceJson({ prospects: data, nextCursor, hasMore });
}
