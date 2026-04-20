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

  // Verify thread belongs to workspace (include prospectId for status sync)
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    select: { id: true, prospectId: true },
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

  // Sync the most recently applied label as the prospect's leadStatus so
  // the leads page reflects the change immediately.
  if (thread.prospectId) {
    await prisma.prospect.update({
      where: { id: thread.prospectId },
      data: { leadStatus: label.name },
    });
  }

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
    select: { id: true, prospectId: true },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  await prisma.threadLabel.deleteMany({
    where: { threadId, labelId },
  });

  // After removing a label, set leadStatus to the next remaining label (if
  // any), or clear it. This keeps the leads page in sync with inbox labels.
  if (thread.prospectId) {
    const remaining = await prisma.threadLabel.findFirst({
      where: { threadId },
      orderBy: { appliedAt: "desc" },
      include: { label: { select: { name: true } } },
    });
    await prisma.prospect.update({
      where: { id: thread.prospectId },
      data: { leadStatus: remaining?.label.name ?? null },
    });
  }

  const providerSync = await syncProviderTags(workspaceId!, threadId);

  return NextResponse.json({ success: true, providerSync });
}
