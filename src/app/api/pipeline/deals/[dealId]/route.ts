import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { logActivity } from "@/services/lead-activity";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { dealId } = await params;
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = String(body.title).trim();
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.value !== undefined) data.value = body.value != null ? Number(body.value) : null;

    // Fetch deal before update so we can capture old stage name for activity log
    const dealBefore = body.stageId !== undefined
      ? await prisma.pipelineDeal.findFirst({
          where: { id: dealId, workspaceId: workspaceId! },
          select: {
            threadId: true,
            prospectId: true,
            stage: { select: { name: true } },
            pipeline: { select: { name: true } },
          },
        })
      : null;

    if (body.stageId !== undefined) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: body.stageId, pipeline: { workspaceId: workspaceId! } },
      });
      if (!stage) {
        return NextResponse.json({ error: "Stage not found" }, { status: 404 });
      }
      data.stageId = body.stageId;
    }

    const updated = await prisma.pipelineDeal.updateMany({
      where: { id: dealId, workspaceId: workspaceId! },
      data,
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Log pipeline_moved when stageId changed
    if (dealBefore && body.stageId !== undefined) {
      const newStage = await prisma.pipelineStage.findFirst({
        where: { id: body.stageId as string },
        select: { name: true },
      });
      if (newStage) {
        logActivity(
          workspaceId!,
          dealBefore.threadId ?? null,
          dealBefore.prospectId ?? null,
          "pipeline_moved",
          {
            pipeline: dealBefore.pipeline.name,
            fromStage: dealBefore.stage.name,
            toStage: newStage.name,
          }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pipeline/deals PATCH]", e);
    return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { dealId } = await params;

    // Fetch deal before delete to capture context for activity log
    const dealToDelete = await prisma.pipelineDeal.findFirst({
      where: { id: dealId, workspaceId: workspaceId! },
      select: {
        threadId: true,
        prospectId: true,
        stage: { select: { name: true } },
        pipeline: { select: { name: true } },
      },
    });

    const deleted = await prisma.pipelineDeal.deleteMany({
      where: { id: dealId, workspaceId: workspaceId! },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (dealToDelete) {
      logActivity(
        workspaceId!,
        dealToDelete.threadId ?? null,
        dealToDelete.prospectId ?? null,
        "pipeline_removed",
        { pipeline: dealToDelete.pipeline.name, stage: dealToDelete.stage.name }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pipeline/deals DELETE]", e);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
