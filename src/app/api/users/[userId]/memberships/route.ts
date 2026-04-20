import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

/**
 * Returns all workspace memberships for a specific user.
 * ADMIN+ only — used by the edit member dialog to pre-fill workspace checkboxes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { error } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { userId } = await params;

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      workspaceId: true,
      role: true,
      workspace: { select: { name: true } },
    },
  });

  return NextResponse.json(memberships);
}
