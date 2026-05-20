import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { id } = await params;
  const { isActive } = (await req.json()) as { isActive?: boolean };

  const hook = await prisma.outboundWebhook.findUnique({ where: { id } });
  if (!hook || hook.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.outboundWebhook.update({
    where: { id },
    data: { isActive: isActive ?? hook.isActive },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { id } = await params;

  const hook = await prisma.outboundWebhook.findUnique({ where: { id } });
  if (!hook || hook.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.outboundWebhook.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
