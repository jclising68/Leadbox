import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { replyViaInstantly } from "@/services/instantly-reply";
import { replyViaHeyreach } from "@/services/heyreach-reply";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const { body } = await req.json();

  if (!body || !body.trim()) {
    return NextResponse.json(
      { error: "Message body is required" },
      { status: 400 }
    );
  }

  // Get thread with channel info
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    select: { id: true, channel: true },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Find the active integration for this channel
  const providerForChannel =
    thread.channel === "EMAIL" ? "INSTANTLY" : "HEYREACH";

  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: workspaceId!,
      provider: providerForChannel,
      isActive: true,
    },
  });

  if (!integration) {
    return NextResponse.json(
      {
        error: `No active ${providerForChannel} integration found. Add one in Settings > Integrations.`,
      },
      { status: 400 }
    );
  }

  try {
    let result;
    if (thread.channel === "EMAIL") {
      result = await replyViaInstantly(integration.id, threadId, body);
    } else {
      result = await replyViaHeyreach(integration.id, threadId, body);
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (err) {
    console.error(
      `[reply] Failed to send via ${providerForChannel}:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to send message",
      },
      { status: 500 }
    );
  }
}
