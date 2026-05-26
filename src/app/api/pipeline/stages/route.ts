import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

// POST — add a stage to an existing pipeline
export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { pipelineId, name, color } = await req.json();

    if (!pipelineId || !name?.trim()) {
      return NextResponse.json({ error: "pipelineId and name are required" }, { status: 400 });
    }

    // Verify pipeline belongs to workspace
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, workspaceId: workspaceId! },
      select: { id: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const last = await prisma.pipelineStage.findFirst({
      where: { pipelineId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId,
        name: name.trim(),
        color: color ?? "#6B7280",
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json(stage, { status: 201 });
  } catch (e) {
    console.error("[pipeline/stages POST]", e);
    return NextResponse.json({ error: "Failed to create stage" }, { status: 500 });
  }
}
