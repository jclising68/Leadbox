import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: workspaceId! },
    include: {
      user: { select: { id: true, email: true, name: true, avatarUrl: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  return workspaceJson(members);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { email, role } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "User not found. They must register first." },
      { status: 404 }
    );
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspaceId! },
    },
  });

  if (existing) {
    return NextResponse.json(
      { error: "User is already a member" },
      { status: 400 }
    );
  }

  // Validate role — ADMIN cannot assign OWNER
  const allowedRoles = ["ADMIN", "MEMBER", "VIEWER"];
  const assignRole = role && allowedRoles.includes(role) ? role : "MEMBER";

  const member = await prisma.workspaceMember.create({
    data: {
      userId: user.id,
      workspaceId: workspaceId!,
      role: assignRole,
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json(member, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { userId } = await req.json();

  // Prevent removing OWNER from the workspace
  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: workspaceId! } },
  });

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role === "OWNER") {
    return NextResponse.json(
      { error: "Cannot remove the workspace owner" },
      { status: 403 }
    );
  }

  await prisma.workspaceMember.delete({
    where: { id: target.id },
  });

  return NextResponse.json({ success: true });
}
