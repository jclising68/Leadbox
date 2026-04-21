import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

type PatchBody = {
  isActive?: boolean;
  clearSyncLock?: boolean;
  clearError?: boolean;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;
  const body: PatchBody = await req.json();

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
    select: { id: true, config: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const data: { isActive?: boolean; config?: object } = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;

  if (body.clearSyncLock || body.clearError) {
    const config = ((integration.config as Record<string, unknown>) ?? {});
    if (body.clearSyncLock) {
      delete config.syncRunning;
      delete config.syncStartedAt;
    }
    if (body.clearError) {
      delete config.lastError;
      delete config.lastErrorAt;
    }
    data.config = config as object;
  }

  const updated = await prisma.integration.update({
    where: { id },
    data,
    select: { id: true, isActive: true },
  });

  return NextResponse.json({ success: true, integration: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
    select: { id: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  await prisma.integration.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
