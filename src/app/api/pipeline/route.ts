import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    const { error, workspaceId } = await requireWorkspaceAccess(req);
    if (error) return error;

    const pipelines = await prisma.pipeline.findMany({
      where: { workspaceId: workspaceId! },
      include: {
        stages: { orderBy: { sortOrder: "asc" } },
        _count: { select: { deals: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(pipelines);
  } catch (e) {
    console.error("[GET /api/pipeline]", e);
    return NextResponse.json({ error: "Failed to load pipelines" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
    if (error) return error;

    const { name, stages } = await req.json() as {
      name: string;
      stages: Array<{ name: string; color: string }>;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Pipeline name is required" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        workspaceId: workspaceId!,
        name: name.trim(),
        stages: {
          create: (stages ?? []).map((s, i) => ({
            name: s.name.trim(),
            color: s.color ?? "#6B7280",
            sortOrder: i,
          })),
        },
      },
      include: {
        stages: { orderBy: { sortOrder: "asc" } },
        _count: { select: { deals: true } },
      },
    });

    return NextResponse.json(pipeline, { status: 201 });
  } catch (e) {
    console.error("[POST /api/pipeline]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
