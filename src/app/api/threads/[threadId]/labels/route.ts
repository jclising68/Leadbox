import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { decrypt } from "@/lib/crypto";
import { after } from "next/server";

async function pushTagToProvider(
  workspaceId: string,
  threadId: string,
  labelName: string
) {
  // Get thread with prospect info
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true, linkedinUrl: true } },
    },
  });
  if (!thread) return;

  const provider = thread.channel === "EMAIL" ? "INSTANTLY" : "HEYREACH";
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, provider, isActive: true },
  });
  if (!integration) return;

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  try {
    if (provider === "INSTANTLY" && thread.prospect.email) {
      // Push tag to Instantly lead
      await fetch("https://api.instantly.ai/api/v2/leads/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: thread.prospect.email,
          update: { tags: [labelName] },
        }),
      });
    } else if (provider === "HEYREACH" && thread.prospect.linkedinUrl) {
      // Push tag to HeyReach lead
      await fetch("https://api.heyreach.io/api/public/Lead/AddTags", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileUrl: thread.prospect.linkedinUrl,
          tags: [labelName],
        }),
      });
    }
  } catch (err) {
    console.error(
      `[labels] Failed to push tag "${labelName}" to ${provider}:`,
      err instanceof Error ? err.message : err
    );
  }
}

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

  // Push tag to Instantly/HeyReach in background
  after(() => pushTagToProvider(workspaceId!, threadId, label.name));

  return NextResponse.json(threadLabel);
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

  return NextResponse.json({ success: true });
}
