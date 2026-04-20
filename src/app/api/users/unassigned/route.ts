import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

/**
 * Returns registered users who have not yet been assigned to ANY workspace.
 * Once an admin places them into one workspace, they stop appearing here on
 * every other workspace's members page — the admin has made the assignment
 * decision, so no further nagging.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const unassigned = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      memberships: {
        select: {
          workspace: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return workspaceJson(unassigned);
}
