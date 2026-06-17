import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";
import { logActivity } from "@/services/lead-activity";

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
  let followUpBeingSet = false;
  let followUpBeingCleared = false;
  if (body.followUpAt !== undefined) {
    if (body.followUpAt === null) {
      data.followUpAt = null;
      followUpBeingCleared = true;
    } else {
      const date = new Date(body.followUpAt);
      if (isNaN(date.getTime())) {
        return NextResponse.json({ error: "Invalid followUpAt date" }, { status: 400 });
      }
      data.followUpAt = date;
      data.followUpSlackSentAt = null;
      applyFollowUpLabel = true;
      followUpBeingSet = true;
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

  // Auto-create a PipelineDeal in the "Follow Up" stage when followUpAt is set
  if (followUpBeingSet) {
    autoCreateFollowUpDeal(threadId, workspaceId!).catch((err) =>
      console.error("[thread PATCH] autoCreateFollowUpDeal failed", err)
    );
    logActivity(workspaceId!, threadId, null, "follow_up_scheduled", { date: data.followUpAt instanceof Date ? (data.followUpAt as Date).toISOString() : null });
  }

  // Auto-remove the PipelineDeal when followUpAt is manually cleared
  if (followUpBeingCleared) {
    removeFollowUpDeal(threadId, workspaceId!).catch((err) =>
      console.error("[thread PATCH] removeFollowUpDeal failed", err)
    );
    logActivity(workspaceId!, threadId, null, "follow_up_cleared", {});
  }

  return NextResponse.json({ success: true });
}

// ─── Pipeline helpers ────────────────────────────────────────────────────────

/**
 * When followUpAt is set on a thread, upsert a PipelineDeal in the workspace's
 * first pipeline's "Follow Up" stage. If that stage doesn't exist yet (legacy
 * pipeline), create it lazily. Idempotent: skips if a deal for this thread
 * already exists in a "Follow Up" stage.
 */
async function autoCreateFollowUpDeal(threadId: string, workspaceId: string) {
  // Fetch the thread to get prospectId and prospect name
  const threadRow = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId },
    select: {
      prospectId: true,
      prospect: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!threadRow) return;

  // Check if a deal already exists for this thread in any "Follow Up" stage
  const existingDeal = await prisma.pipelineDeal.findFirst({
    where: {
      threadId,
      workspaceId,
      stage: { name: "Follow Up" },
    },
    select: { id: true },
  });
  if (existingDeal) return;

  // Find the oldest pipeline for this workspace
  const pipeline = await prisma.pipeline.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    include: { stages: { select: { id: true, name: true, sortOrder: true } } },
  });
  if (!pipeline) return;

  // Find or lazily create the "Follow Up" stage
  let stage = pipeline.stages.find((s) => s.name === "Follow Up");
  if (!stage) {
    const maxSortOrder = pipeline.stages.reduce((max, s) => Math.max(max, s.sortOrder), -1);
    stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: "Follow Up",
        color: "#f59e0b",
        sortOrder: maxSortOrder + 1,
      },
    });
  }

  // Build deal title: firstName+lastName, or email, or fallback
  const { firstName, lastName, email } = threadRow.prospect;
  const nameParts = [firstName, lastName].filter(Boolean).join(" ").trim();
  const title = nameParts || email || "Follow Up";

  await prisma.pipelineDeal.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      prospectId: threadRow.prospectId,
      threadId,
      title,
    },
  });

  logActivity(workspaceId, threadId, threadRow.prospectId ?? null, "pipeline_added", { pipeline: pipeline.name, stage: stage.name });
}

/**
 * Delete all PipelineDeals for this thread that are in a "Follow Up" stage.
 */
async function removeFollowUpDeal(threadId: string, workspaceId: string) {
  await prisma.pipelineDeal.deleteMany({
    where: {
      threadId,
      workspaceId,
      stage: { name: "Follow Up" },
    },
  });
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
