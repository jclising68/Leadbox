import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { replyViaInstantly } from "@/services/instantly-reply";
import { replyViaHeyreach } from "@/services/heyreach-reply";
import { replyViaLemlist } from "@/services/lemlist-reply";
import { replyViaSmtp, type SmtpAttachment } from "@/services/smtp-reply";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const { body, attachments } = await req.json() as {
    body: string;
    attachments?: SmtpAttachment[];
  };

  if (!body || !body.trim()) {
    return NextResponse.json(
      { error: "Message body is required" },
      { status: 400 }
    );
  }

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  // Get thread with channel info
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    select: { id: true, channel: true },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // If attachments present on an email thread, route via SMTP directly
  if (hasAttachments && thread.channel === "EMAIL") {
    try {
      const bodyHtml = body.replace(/\n/g, "<br>");
      const result = await replyViaSmtp(workspaceId!, threadId, bodyHtml, attachments!);
      return NextResponse.json({ success: true, messageId: result.messageId });
    } catch (err) {
      console.error("[reply] SMTP send failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to send via SMTP" },
        { status: 500 }
      );
    }
  }

  // Standard path: route through provider API (no attachments)
  const lastMsg = await prisma.message.findFirst({
    where: { threadId, integrationId: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { integrationId: true },
  });

  let integration = lastMsg?.integrationId
    ? await prisma.integration.findFirst({
        where: { id: lastMsg.integrationId, isActive: true },
      })
    : null;

  if (!integration) {
    integration = await prisma.integration.findFirst({
      where: {
        workspaceId: workspaceId!,
        provider: thread.channel === "EMAIL"
          ? { in: ["INSTANTLY", "LEMLIST"] }
          : { in: ["HEYREACH", "LEMLIST"] },
        isActive: true,
      },
    });
  }

  if (!integration) {
    const providerDesc = thread.channel === "EMAIL" ? "Instantly or Lemlist" : "HeyReach or Lemlist";
    return NextResponse.json(
      {
        error: `No active ${providerDesc} integration found. Add one in Settings > Integrations.`,
      },
      { status: 400 }
    );
  }

  try {
    let result;
    if (thread.channel === "EMAIL") {
      const bodyHtml = body.replace(/\n/g, "<br>");
      if (integration.provider === "LEMLIST") {
        result = await replyViaLemlist(integration.id, threadId, bodyHtml);
      } else {
        result = await replyViaInstantly(integration.id, threadId, bodyHtml);
      }
    } else {
      if (integration.provider === "LEMLIST") {
        result = await replyViaLemlist(integration.id, threadId, body);
      } else {
        result = await replyViaHeyreach(integration.id, threadId, body);
      }
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (err) {
    console.error(
      `[reply] Failed to send via ${integration.provider}:`,
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
