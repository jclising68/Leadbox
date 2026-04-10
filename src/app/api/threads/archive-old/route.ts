import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

// Archive threads with lastMessageAt before 2026-01-01
const ARCHIVE_CUTOFF = new Date("2026-01-01T00:00:00.000Z");

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const result = await prisma.thread.updateMany({
    where: {
      workspaceId: workspaceId!,
      status: "OPEN",
      lastMessageAt: { lt: ARCHIVE_CUTOFF },
    },
    data: { status: "ARCHIVED" },
  });

  return NextResponse.json({
    archived: result.count,
    cutoff: ARCHIVE_CUTOFF.toISOString(),
  });
}
