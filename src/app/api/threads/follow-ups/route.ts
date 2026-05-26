import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const now = new Date();

  const threads = await prisma.thread.findMany({
    where: {
      workspaceId: workspaceId!,
      followUpAt: { not: null, lte: now },
      status: "OPEN",
    },
    select: {
      id: true,
      followUpAt: true,
      prospect: {
        select: { firstName: true, lastName: true, email: true, company: true },
      },
    },
    orderBy: { followUpAt: "asc" },
    take: 20,
  });

  return NextResponse.json(threads);
}
