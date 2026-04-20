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
  const { error, user: caller } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { email, role, workspaceIds } = await req.json();

  if (!Array.isArray(workspaceIds) || workspaceIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one workspace" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "User not found. They must register first." },
      { status: 404 }
    );
  }

  const allowedRoles = ["ADMIN", "MEMBER", "VIEWER"];
  const assignRole = role && allowedRoles.includes(role) ? role : "MEMBER";

  const [callerAdmin, existingMemberships] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: {
        userId: caller.id!,
        workspaceId: { in: workspaceIds },
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { workspaceId: true },
    }),
    prisma.workspaceMember.findMany({
      where: { userId: user.id, workspaceId: { in: workspaceIds } },
      select: { workspaceId: true },
    }),
  ]);
  const authorizedIds = new Set(callerAdmin.map((m) => m.workspaceId));
  const alreadyMember = new Set(existingMemberships.map((m) => m.workspaceId));

  const toCreate = workspaceIds.filter(
    (id: string) => authorizedIds.has(id) && !alreadyMember.has(id)
  );

  if (toCreate.length > 0) {
    await prisma.workspaceMember.createMany({
      data: toCreate.map((workspaceId: string) => ({
        userId: user.id,
        workspaceId,
        role: assignRole,
      })),
    });
  }

  return NextResponse.json(
    {
      added: toCreate.length,
      alreadyMember: workspaceIds.filter((id: string) => alreadyMember.has(id)).length,
      unauthorized: workspaceIds.filter((id: string) => !authorizedIds.has(id)).length,
    },
    { status: 201 }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user: caller } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { userId, role, workspaceIds } = await req.json();

  if (!Array.isArray(workspaceIds) || workspaceIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one workspace" },
      { status: 400 }
    );
  }

  const allowedRoles = ["ADMIN", "MEMBER", "VIEWER"];
  const newRole = role && allowedRoles.includes(role) ? role : "MEMBER";

  const [callerAdmin, current] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId: caller.id!, role: { in: ["OWNER", "ADMIN"] } },
      select: { workspaceId: true },
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      select: { id: true, workspaceId: true, role: true },
    }),
  ]);
  const authorized = new Set(callerAdmin.map((m) => m.workspaceId));
  const desired = new Set(workspaceIds);

  const toCreate: string[] = [];
  const toUpdate: string[] = [];
  const toDelete: string[] = [];

  for (const wsId of workspaceIds) {
    if (!authorized.has(wsId)) continue;
    const existing = current.find((m) => m.workspaceId === wsId);
    if (!existing) toCreate.push(wsId);
    else if (existing.role !== "OWNER") toUpdate.push(existing.id);
  }

  for (const m of current) {
    if (m.role === "OWNER") continue;
    if (!authorized.has(m.workspaceId)) continue;
    if (!desired.has(m.workspaceId)) toDelete.push(m.id);
  }

  await prisma.$transaction([
    ...(toCreate.length > 0
      ? [
          prisma.workspaceMember.createMany({
            data: toCreate.map((workspaceId) => ({
              userId,
              workspaceId,
              role: newRole,
            })),
          }),
        ]
      : []),
    ...(toUpdate.length > 0
      ? [
          prisma.workspaceMember.updateMany({
            where: { id: { in: toUpdate } },
            data: { role: newRole },
          }),
        ]
      : []),
    ...(toDelete.length > 0
      ? [prisma.workspaceMember.deleteMany({ where: { id: { in: toDelete } } })]
      : []),
  ]);

  return NextResponse.json({ success: true });
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
