import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { stageId } = await params;
    const body = await req.json();

    // Verify ownership via pipeline → workspace
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { workspaceId: workspaceId! } },
      select: { id: true },
    });
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.color !== undefined) data.color = String(body.color);
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);

    await prisma.pipelineStage.update({ where: { id: stageId }, data });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pipeline/stages PATCH]", e);
    return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { stageId } = await params;

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { workspaceId: workspaceId! } },
      select: { _count: { select: { deals: true } } },
    });

    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    if (stage._count.deals > 0) {
      return NextResponse.json(
        { error: `Move or delete the ${stage._count.deals} deal(s) in this stage first` },
        { status: 409 }
      );
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pipeline/stages DELETE]", e);
    return NextResponse.json({ error: "Failed to delete stage" }, { status: 500 });
  }
}
