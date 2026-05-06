import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id: paramId, keyId } = await params;
  if (paramId !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = await prisma.workspaceApiKey.findFirst({
    where: { id: keyId, workspaceId: workspaceId! },
  });

  if (!key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.workspaceApiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
