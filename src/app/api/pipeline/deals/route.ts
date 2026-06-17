import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { logActivity } from "@/services/lead-activity";

const DEAL_SELECT = {
  id: true,
  pipelineId: true,
  stageId: true,
  title: true,
  notes: true,
  value: true,
  createdAt: true,
  prospectId: true,
  threadId: true,
  prospect: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: true,
      title: true,
    },
  },
};

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const pipelineId = url.searchParams.get("pipelineId");

    const deals = await prisma.pipelineDeal.findMany({
      where: {
        workspaceId: workspaceId!,
        ...(pipelineId ? { pipelineId } : {}),
      },
      select: DEAL_SELECT,
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    return NextResponse.json(deals);
  } catch (e) {
    console.error("[pipeline/deals GET]", e);
    return NextResponse.json({ error: "Failed to load deals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { pipelineId, stageId, title, notes, value, prospectId, threadId } = await req.json();

    if (!pipelineId || !stageId || !title?.trim()) {
      return NextResponse.json({ error: "pipelineId, stageId and title are required" }, { status: 400 });
    }

    // Verify pipeline + stage belong to workspace
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { id: pipelineId, workspaceId: workspaceId! } },
      select: { id: true },
    });
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const deal = await prisma.pipelineDeal.create({
      data: {
        workspaceId: workspaceId!,
        pipelineId,
        stageId,
        title: title.trim(),
        notes: notes ?? null,
        value: value != null ? Number(value) : null,
        prospectId: prospectId ?? null,
        threadId: threadId ?? null,
      },
      select: {
        ...DEAL_SELECT,
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
      },
    });

    logActivity(workspaceId!, deal.threadId ?? null, deal.prospectId ?? null, "pipeline_added", { pipeline: deal.pipeline.name, stage: deal.stage.name });

    return NextResponse.json(deal, { status: 201 });
  } catch (e) {
    console.error("[pipeline/deals POST]", e);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
