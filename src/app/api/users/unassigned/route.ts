import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

/**
 * Returns all registered users who are NOT a member of the current workspace.
 * Visible to ADMIN+ only — used on the Members settings page so admins can
 * see new registrations and assign them to workspaces.
 */
export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  // Get all user IDs that are already members of this workspace
  const existingMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: workspaceId! },
    select: { userId: true },
  });
  const memberUserIds = existingMembers.map((m) => m.userId);

  // Find all users NOT in this workspace, ordered by most recent first
  const unassigned = await prisma.user.findMany({
    where: {
      id: { notIn: memberUserIds },
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      memberships: {
        select: {
          workspace: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return workspaceJson(unassigned);
}
