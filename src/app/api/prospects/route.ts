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
        // When the user explicitly sets a tag, replace ALL existing MANUAL and
        // WEBHOOK labels. WEBHOOK labels come from Instantly/HeyReach sync and
        // setting a tag manually should override them.
        await prisma.threadLabel.deleteMany({
          where: { threadId, source: { in: ["MANUAL", "WEBHOOK"] }, labelId: { not: label.id } },
        });

        // Upsert the new label as MANUAL (user-set takes precedence)
        await prisma.threadLabel.upsert({
          where: { threadId_labelId: { threadId, labelId: label.id } },
          update: { source: "MANUAL", appliedAt: new Date() },
          create: { threadId, labelId: label.id, source: "MANUAL" },
        });
      }
    } else {
      // Clearing the status — remove MANUAL and WEBHOOK labels so the
      // user can fully clear Instantly-synced classifications too.
      await prisma.threadLabel.deleteMany({
        where: { threadId, source: { in: ["MANUAL", "WEBHOOK"] } },
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
  const providerFilter = url.searchParams.get("provider");
  const actionable = url.searchParams.get("actionable");
  const leadStatusFilter = url.searchParams.get("leadStatus");
  const showUnsubscribed = url.searchParams.get("showUnsubscribed") === "true";

  const where: Prisma.ProspectWhereInput = {
    workspaceId: workspaceId!,
    // showUnsubscribed=true → only unsubscribed; default → only subscribed
    isUnsubscribed: showUnsubscribed ? true : false,
  };

  // Isolated AND condition — never merged into where.thread so it can't be
  // dropped by the channel/hasReply/label/date spread-chain below.
  const andConditions: Prisma.ProspectWhereInput[] = [
    { thread: { status: { not: "TRASH" } } },
  ];

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

  if (providerFilter) {
    andConditions.push({
      thread: { messages: { some: { integration: { provider: providerFilter as "INSTANTLY" | "HEYREACH" | "LEMLIST" } } } },
    });
  }

  // Show only "actionable" leads: those that replied OR have tags from
  // Instantly/HeyReach. Uses precise data signals — no hardcoded status lists.
  //   1. Has INBOUND messages = lead replied
  //   2. Has WEBHOOK-source labels = tagged in Instantly/HeyReach
  //   3. stepReplied is set = enrichment confirmed reply from Instantly API
  if (actionable === "true") {
    andConditions.push({
      OR: [
        { thread: { messages: { some: { direction: "INBOUND" } } } },
        { thread: { threadLabels: { some: { source: "WEBHOOK" } } } },
        { stepReplied: { not: null } },
      ],
    });
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

  // Merge all AND conditions (TRASH exclusion is always first)
  where.AND = andConditions;

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
            // INBOUND sorts before OUTBOUND in the Direction enum declaration,
            // so replies always take priority over sent emails for the provider
            // icon — prevents a Lemlist bulk-send from overwriting an Instantly
            // reply's icon just because it was synced more recently.
            orderBy: [{ direction: "asc" }, { receivedAt: "desc" }],
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
