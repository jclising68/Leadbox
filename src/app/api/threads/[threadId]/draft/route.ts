import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { generateReplyDraft } from "@/services/ai-reply-drafter";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;

  const draft = await prisma.aiDraft.findUnique({ where: { threadId } });

  // Draft already exists — return it regardless of status
  if (draft && draft.workspaceId === workspaceId) {
    return NextResponse.json(draft);
  }

  // No draft yet — check if this thread has any INBOUND messages and the
  // workspace has AI reply enabled. If so, kick off generation now so existing
  // threads get drafted the first time anyone opens them.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId! },
    select: { aiReplyEnabled: true },
  });

  if (workspace?.aiReplyEnabled) {
    const hasInbound = await prisma.message.findFirst({
      where: { threadId, direction: "INBOUND" },
      select: { id: true },
    });

    if (hasInbound) {
      after(() => generateReplyDraft(workspaceId!, threadId));
      return NextResponse.json({ threadId, status: "PENDING", body: "", model: "" });
    }
  }

  return NextResponse.json(null);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const body = await req.json().catch(() => ({}));
  const intent = body.intent as string | undefined;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId! },
    select: { aiReplyEnabled: true },
  });

  if (!workspace?.aiReplyEnabled) {
    return NextResponse.json({ error: "AI reply not enabled for this workspace" }, { status: 400 });
  }

  // Discard existing draft so the new one can be generated
  await prisma.aiDraft.deleteMany({ where: { threadId, workspaceId: workspaceId! } });

  // Kick off generation with the requested intent
  after(() => generateReplyDraft(workspaceId!, threadId, intent));

  return NextResponse.json({ threadId, status: "PENDING", body: "", model: "" });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;

  const draft = await prisma.aiDraft.findUnique({ where: { threadId } });
  if (!draft || draft.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.aiDraft.update({
    where: { threadId },
    data: { status: "DISCARDED" },
  });

  return NextResponse.json({ success: true });
}
