import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ prospectId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { prospectId } = await params;

  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId: workspaceId! },
    select: { id: true, isUnsubscribed: true },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  if (!prospect.isUnsubscribed) {
    return NextResponse.json({ message: "Not unsubscribed" });
  }

  await prisma.prospect.update({
    where: { id: prospectId },
    data: { isUnsubscribed: false, unsubscribedAt: null },
  });

  return NextResponse.json({ success: true });
}
