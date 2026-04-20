import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

/**
 * Registered users who are NOT currently a member of this workspace.
 * Used to populate the email combobox in the Add Member dialog so admins
 * can pick someone from a dropdown instead of typing manually. Includes
 * each user's existing memberships so the dialog can lock those checkboxes.
 */
export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const users = await prisma.user.findMany({
    where: { memberships: { none: { workspaceId: workspaceId! } } },
    select: {
      id: true,
      email: true,
      name: true,
      memberships: {
        select: {
          workspace: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return workspaceJson(users);
}
