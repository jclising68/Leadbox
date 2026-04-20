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

  const { email, role, workspaceIds } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "User not found. They must register first." },
      { status: 404 }
    );
  }

  // Validate role — ADMIN cannot assign OWNER
  const allowedRoles = ["ADMIN", "MEMBER", "VIEWER"];
  const assignRole = role && allowedRoles.includes(role) ? role : "MEMBER";

  // Determine target workspaces: use provided list, or fall back to current
  const targetIds: string[] =
    Array.isArray(workspaceIds) && workspaceIds.length > 0
      ? workspaceIds
      : [workspaceId!];

  // Verify the calling user has ADMIN+ access to all target workspaces
  const callerMemberships = await prisma.workspaceMember.findMany({
    where: {
      userId: (await prisma.workspaceMember.findFirst({
        where: { workspaceId: workspaceId! },
        select: { userId: true },
      }))?.userId,
      workspaceId: { in: targetIds },
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: { workspaceId: true },
  });
  const authorizedIds = new Set(callerMemberships.map((m) => m.workspaceId));

  // Create memberships for all authorized target workspaces (skip duplicates)
  let added = 0;
  let skipped = 0;
  const results: string[] = [];

  for (const wsId of targetIds) {
    if (!authorizedIds.has(wsId)) {
      skipped++;
      continue;
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: wsId } },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.workspaceMember.create({
      data: { userId: user.id, workspaceId: wsId, role: assignRole },
    });
    added++;

    const ws = await prisma.workspace.findUnique({
      where: { id: wsId },
      select: { name: true },
    });
    results.push(ws?.name || wsId);
  }

  if (added === 0 && skipped > 0) {
    return NextResponse.json(
      { error: "User is already a member of the selected workspace(s)" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { added, skipped, workspaces: results },
    { status: 201 }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId, user } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { userId, role, workspaceIds } = await req.json();

  // Find the target member in the current workspace
  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: workspaceId! } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (target.role === "OWNER") {
    return NextResponse.json(
      { error: "Cannot edit workspace owner" },
      { status: 403 }
    );
  }

  const allowedRoles = ["ADMIN", "MEMBER", "VIEWER"];
  const newRole = role && allowedRoles.includes(role) ? role : target.role;

  // Update role in current workspace
  await prisma.workspaceMember.update({
    where: { id: target.id },
    data: { role: newRole },
  });

  // Reconcile workspace access if workspaceIds provided
  if (Array.isArray(workspaceIds)) {
    // Verify caller has ADMIN+ access to all target workspaces
    const callerMemberships = await prisma.workspaceMember.findMany({
      where: {
        userId: user.id!,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { workspaceId: true },
    });
    const callerAuthorized = new Set(callerMemberships.map((m) => m.workspaceId));

    // Get user's current memberships
    const currentMemberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true, role: true, id: true },
    });
    const currentWsIds = new Set(currentMemberships.map((m) => m.workspaceId));

    // Add new workspace memberships
    for (const wsId of workspaceIds) {
      if (!currentWsIds.has(wsId) && callerAuthorized.has(wsId)) {
        await prisma.workspaceMember.create({
          data: { userId, workspaceId: wsId, role: newRole },
        });
      }
    }

    // Remove memberships for deselected workspaces (only ones caller has access to)
    const desiredSet = new Set(workspaceIds);
    for (const membership of currentMemberships) {
      if (
        !desiredSet.has(membership.workspaceId) &&
        callerAuthorized.has(membership.workspaceId) &&
        membership.role !== "OWNER" // never remove OWNER
      ) {
        await prisma.workspaceMember.delete({ where: { id: membership.id } });
      }
    }

    // Update role in all selected workspaces the caller controls
    for (const wsId of workspaceIds) {
      if (wsId !== workspaceId && callerAuthorized.has(wsId)) {
        const existing = await prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wsId } },
        });
        if (existing && existing.role !== "OWNER") {
          await prisma.workspaceMember.update({
            where: { id: existing.id },
            data: { role: newRole },
          });
        }
      }
    }
  }

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
