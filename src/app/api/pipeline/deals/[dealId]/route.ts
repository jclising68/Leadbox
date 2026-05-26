import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

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

    const deleted = await prisma.pipelineDeal.deleteMany({
      where: { id: dealId, workspaceId: workspaceId! },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pipeline/deals DELETE]", e);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
