import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { id } = await params;
  const { isActive, triggers } = (await req.json()) as { isActive?: boolean; triggers?: string[] };

  const hook = await prisma.outboundWebhook.findUnique({ where: { id } });
  if (!hook || hook.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const validTriggers = ["reply_received", "lead_tagged"];
  const data: { isActive?: boolean; triggers?: string[] } = {
    isActive: isActive ?? hook.isActive,
  };
  if (triggers !== undefined) {
    data.triggers = triggers.filter((t) => validTriggers.includes(t));
  }

  const updated = await prisma.outboundWebhook.update({
    where: { id },
    data,
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
