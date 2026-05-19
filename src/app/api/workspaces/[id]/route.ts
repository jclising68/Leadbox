import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify user is OWNER or ADMIN
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id!, workspaceId: id } },
  });

  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await req.json()) as {
    name?: string;
    autoCreateLabels?: boolean;
    aiReplyEnabled?: boolean;
    aiReplyMode?: "HUMAN_IN_LOOP" | "AUTO_REPLY";
    aiReplyProvider?: "openai" | "claude";
    aiReplyInstructions?: string | null;
    aiLabelProvider?: "openai" | "claude";
    kpiEmbedToken?: string | null;
  };

  const data: {
    name?: string;
    slug?: string;
    autoCreateLabels?: boolean;
    aiReplyEnabled?: boolean;
    aiReplyMode?: "HUMAN_IN_LOOP" | "AUTO_REPLY";
    aiReplyProvider?: string | null;
    aiReplyInstructions?: string | null;
    aiLabelProvider?: string | null;
    kpiEmbedToken?: string | null;
  } = {};

  if (body.name !== undefined) {
    if (!body.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    data.name = body.name;
    data.slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  if (typeof body.autoCreateLabels === "boolean") {
    data.autoCreateLabels = body.autoCreateLabels;
  }

  if (typeof body.aiReplyEnabled === "boolean") {
    data.aiReplyEnabled = body.aiReplyEnabled;
  }

  if (body.aiReplyMode === "HUMAN_IN_LOOP" || body.aiReplyMode === "AUTO_REPLY") {
    data.aiReplyMode = body.aiReplyMode;
  }

  if (body.aiReplyProvider === "openai" || body.aiReplyProvider === "claude") {
    data.aiReplyProvider = body.aiReplyProvider;
  }

  if (body.aiReplyInstructions !== undefined) {
    data.aiReplyInstructions = body.aiReplyInstructions || null;
  }

  if (body.aiLabelProvider === "openai" || body.aiLabelProvider === "claude") {
    data.aiLabelProvider = body.aiLabelProvider;
  }

  if (body.kpiEmbedToken !== undefined) {
    data.kpiEmbedToken = body.kpiEmbedToken || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const workspace = await prisma.workspace.update({
    where: { id },
    data,
  });

  return NextResponse.json(workspace);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Only OWNER can delete
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id!, workspaceId: id } },
  });

  if (!membership || membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only workspace owner can delete" }, { status: 403 });
  }

  // Cascade delete handles all related data
  await prisma.workspace.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
