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

  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const workspace = await prisma.workspace.update({
    where: { id },
    data: { name, slug },
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
