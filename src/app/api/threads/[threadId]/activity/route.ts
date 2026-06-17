import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;
  const { threadId } = await params;

  const activities = await prisma.leadActivity.findMany({
    where: { workspaceId: workspaceId!, threadId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(activities);
}
