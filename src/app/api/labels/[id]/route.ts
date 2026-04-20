import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;
  const body = await req.json();

  const label = await prisma.label.findFirst({
    where: { id, workspaceId: workspaceId! },
  });

  if (!label) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  const updated = await prisma.label.update({
    where: { id },
    data: {
      name: body.name,
      color: body.color,
      icon: body.icon,
      sortOrder: body.sortOrder,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;

  const label = await prisma.label.findFirst({
    where: { id, workspaceId: workspaceId! },
  });

  if (!label) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  await prisma.label.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
