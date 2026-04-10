import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

export async function getAuthUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

export async function getWorkspaceMembership(
  userId: string,
  workspaceId: string
) {
  return prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId },
    },
  });
}

export async function requireAuth(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}

export async function requireWorkspaceAccess(
  req: NextRequest,
  minRole: Role = "VIEWER"
) {
  const { user, error } = await requireAuth(req);
  if (error) return { error };

  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return {
      error: NextResponse.json(
        { error: "Missing x-workspace-id header" },
        { status: 400 }
      ),
    };
  }

  const membership = await getWorkspaceMembership(user!.id!, workspaceId);
  if (!membership) {
    return {
      error: NextResponse.json(
        { error: "Not a member of this workspace" },
        { status: 403 }
      ),
    };
  }

  const roleHierarchy: Role[] = ["VIEWER", "MEMBER", "ADMIN", "OWNER"];
  const userLevel = roleHierarchy.indexOf(membership.role);
  const requiredLevel = roleHierarchy.indexOf(minRole);

  if (userLevel < requiredLevel) {
    return {
      error: NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      ),
    };
  }

  return { user: user!, workspaceId, membership };
}
