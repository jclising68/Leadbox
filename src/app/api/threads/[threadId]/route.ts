import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { threadId } = await params;

  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    include: {
      prospect: {
        include: {
          pipelineDeals: {
            include: {
              stage: { select: { id: true, name: true, color: true } },
              pipeline: { select: { id: true, name: true } },
            },
          },
        },
      },
      threadLabels: { include: { label: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 200,
        include: { integration: { select: { name: true, provider: true } } },
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return workspaceJson(thread);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};

  // Validate status enum
  if (body.status !== undefined) {
    const validStatuses = ["OPEN", "ARCHIVED", "SPAM", "TRASH"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }
    data.status = body.status;
  }

  // Validate isUnread is boolean
  if (body.isUnread !== undefined) {
    if (typeof body.isUnread !== "boolean") {
      return NextResponse.json({ error: "isUnread must be a boolean" }, { status: 400 });
    }
    data.isUnread = body.isUnread;
  }

  // assignedTo is a string or null
  if (body.assignedTo !== undefined) {
    data.assignedTo = body.assignedTo;
  }

  // followUpAt is an ISO string, null to clear, or undefined to skip
  let applyFollowUpLabel = false;
  if (body.followUpAt !== undefined) {
    if (body.followUpAt === null) {
      data.followUpAt = null;
    } else {
      const date = new Date(body.followUpAt);
      if (isNaN(date.getTime())) {
        return NextResponse.json({ error: "Invalid followUpAt date" }, { status: 400 });
      }
      data.followUpAt = date;
      data.followUpSlackSentAt = null;
      applyFollowUpLabel = true;
    }
  }

  const thread = await prisma.thread.updateMany({
    where: { id: threadId, workspaceId: workspaceId! },
    data,
  });

  if (thread.count === 0) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Auto-apply the "Follow Up" system label when a follow-up date is set
  if (applyFollowUpLabel) {
    const followUpLabel = await prisma.label.findFirst({
      where: { workspaceId: workspaceId!, name: "Follow Up" },
      select: { id: true },
    });
    if (followUpLabel) {
      await prisma.threadLabel.upsert({
        where: { threadId_labelId: { threadId, labelId: followUpLabel.id } },
        create: { threadId, labelId: followUpLabel.id, source: "MANUAL" },
        update: {},
      });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;

  // Verify ownership and get prospectId for cascade delete
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    select: { prospectId: true },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Deleting the prospect cascades to Thread → Messages, ThreadLabels, AiDraft
  await prisma.prospect.delete({ where: { id: thread.prospectId } });

  return NextResponse.json({ success: true });
}
