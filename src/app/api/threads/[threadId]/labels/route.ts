import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncProviderTags } from "@/services/provider-tags";

/**
 * Local DB op + provider push are awaited inline (not via `after()`) so the
 * frontend toast can surface what the provider returned. The DB op succeeds
 * first regardless — provider failure does not roll it back. Latency is ~1s.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const { labelId } = await req.json();

  // Verify thread belongs to workspace
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Verify label belongs to workspace
  const label = await prisma.label.findFirst({
    where: { id: labelId, workspaceId: workspaceId! },
  });
  if (!label) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  const threadLabel = await prisma.threadLabel.upsert({
    where: { threadId_labelId: { threadId, labelId } },
    update: { source: "MANUAL", appliedAt: new Date() },
    create: { threadId, labelId, source: "MANUAL" },
    include: { label: true },
  });

  const providerSync = await syncProviderTags(workspaceId!, threadId);

  return NextResponse.json({ ...threadLabel, providerSync });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const { labelId } = await req.json();

  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  await prisma.threadLabel.deleteMany({
    where: { threadId, labelId },
  });

  const providerSync = await syncProviderTags(workspaceId!, threadId);

  return NextResponse.json({ success: true, providerSync });
}
