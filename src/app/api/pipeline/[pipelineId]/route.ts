import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  try {
    const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
    if (error) return error;

    const { pipelineId } = await params;
    const { name } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const updated = await prisma.pipeline.updateMany({
      where: { id: pipelineId, workspaceId: workspaceId! },
      data: { name: name.trim() },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[PATCH /api/pipeline/[id]]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  try {
    const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
    if (error) return error;

    const { pipelineId } = await params;

    const deleted = await prisma.pipeline.deleteMany({
      where: { id: pipelineId, workspaceId: workspaceId! },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[DELETE /api/pipeline/[id]]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
