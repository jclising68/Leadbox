import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncProviderTags } from "@/services/provider-tags";
import { fireOutboundWebhooks } from "@/services/outbound-webhooks";
import { logActivity } from "@/services/lead-activity";

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

  // Verify thread belongs to workspace; include prospect fields for outbound webhook
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    select: {
      id: true,
      channel: true,
      prospectId: true,
      prospect: {
        select: {
          email: true, firstName: true, lastName: true,
          company: true, domain: true, phone: true,
          title: true, linkedinUrl: true, campaignName: true,
          stepReplied: true, notes: true, feedback: true,
        },
      },
    },
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

  // Provider sync — fire-and-forget so the UI updates immediately without
  // waiting for 4-5 sequential Instantly API calls (~5-10s).
  syncProviderTags(workspaceId!, threadId).catch((err) =>
    console.error("[thread labels POST] provider sync failed:", err)
  );

  // Fire outbound webhook — fire-and-forget, never blocks the response
  if (thread.prospect) {
    const p = thread.prospect;
    prisma.message.findFirst({
      where: { threadId, direction: "INBOUND" },
      orderBy: { sentAt: "desc" },
      select: { bodyText: true, messageText: true },
    }).then((latestReply) =>
      fireOutboundWebhooks(workspaceId!, {
        event: "lead_tagged",
        email: p.email ?? null,
        firstName: p.firstName ?? null,
        lastName: p.lastName ?? null,
        company: p.company ?? null,
        domain: p.domain ?? null,
        phone: p.phone ?? null,
        title: p.title ?? null,
        linkedinUrl: p.linkedinUrl ?? null,
        source: thread.channel === "LINKEDIN" ? "LinkedIn" : "Email",
        campaignName: p.campaignName ?? null,
        stepReplied: p.stepReplied ?? null,
        label: label.name,
        replyText: latestReply?.bodyText ?? latestReply?.messageText ?? null,
        notes: p.notes ?? null,
        feedback: p.feedback ?? null,
        timestamp: new Date().toISOString(),
      })
    ).catch((err) => console.error("[thread labels POST] outbound webhook failed:", err));
  }

  logActivity(workspaceId!, threadId, thread.prospectId ?? null, "label_applied", { label: label.name, color: label.color ?? null });

  return NextResponse.json({ ...threadLabel });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const { labelId } = await req.json();

  const [thread, removedLabel] = await Promise.all([
    prisma.thread.findFirst({
      where: { id: threadId, workspaceId: workspaceId! },
      select: { id: true, prospectId: true },
    }),
    prisma.label.findFirst({
      where: { id: labelId, workspaceId: workspaceId! },
      select: { name: true },
    }),
  ]);
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

  syncProviderTags(workspaceId!, threadId).catch((err) =>
    console.error("[thread labels DELETE] provider sync failed:", err)
  );

  if (removedLabel) {
    logActivity(workspaceId!, threadId, thread.prospectId ?? null, "label_removed", { label: removedLabel.name });
  }

  return NextResponse.json({ success: true });
}
