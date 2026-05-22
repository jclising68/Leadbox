import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { normalizeLemlistWebhook } from "@/services/webhook-processor";
import { resolveThread } from "@/services/thread-resolver";
import {
  classifyMessage,
  classificationToLabelName,
  applyAutoLabel,
} from "@/services/auto-labeler";
import { fireOutboundWebhooks } from "@/services/outbound-webhooks";

const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";

async function fetchFullBody(apiKey: string, contactId: string, activityId: string): Promise<string | undefined> {
  try {
    const res = await fetch(LEMLIST_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_inbox_conversation",
          arguments: { contactId, limit: 20 },
        },
      }),
    });

    if (!res.ok) return undefined;

    const data = (await res.json()) as {
      result?: { content?: Array<{ type: string; text: string }> };
    };
    const text = data.result?.content?.find((c) => c.type === "text")?.text;
    if (!text) return undefined;

    const parsed = JSON.parse(text) as {
      activities?: Array<{ id: string; message?: string }>;
    };
    const match = parsed.activities?.find((a) => a.id === activityId);
    return match?.message;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = req.nextUrl.searchParams.get("workspace_id");
    const secret = req.nextUrl.searchParams.get("secret");

    if (!workspaceId || !secret) {
      return NextResponse.json(
        { error: "Missing workspace_id or secret" },
        { status: 400 }
      );
    }

    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId,
        provider: "LEMLIST",
        webhookSecret: secret,
        isActive: true,
      },
    });

    if (!integration) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    const payload = (await req.json()) as Record<string, unknown>;

    const log = await prisma.webhookLog.create({
      data: {
        workspaceId,
        provider: "LEMLIST",
        eventType: (payload.type as string) || "unknown",
        payload: payload as object,
        status: "PENDING",
      },
    });

    const normalized = normalizeLemlistWebhook(payload);

    if (!normalized.prospectEmail) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          status: "SKIPPED",
          errorMessage: "No prospect email",
          processedAt: new Date(),
        },
      });
      return NextResponse.json({ status: "skipped", reason: "no_email" });
    }

    // For inbound replies: fetch full HTML body via MCP
    if (normalized.direction === "INBOUND") {
      const contactId = payload.contactId as string | undefined;
      const activityId = payload._id as string | undefined;
      if (contactId && activityId) {
        const apiKey = decrypt(
          integration.apiKeyEncrypted,
          integration.apiKeyIv,
          integration.apiKeyTag
        );
        const fullBody = await fetchFullBody(apiKey, contactId, activityId);
        if (fullBody) {
          normalized.bodyHtml = fullBody;
          normalized.bodyText = fullBody
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
      }
    }

    const { thread, message, prospect } = await resolveThread(
      workspaceId,
      integration.id,
      normalized
    );

    if (normalized.direction === "INBOUND") {
      after(async () => {
        try {
          const result = await classifyMessage(workspaceId, message.id);
          if (result && result.confidence >= 0.7) {
            const labelName = classificationToLabelName(result.label);
            await applyAutoLabel(
              workspaceId,
              thread.id,
              labelName,
              result.confidence,
              "AUTO_AI"
            );
          }
        } catch (err) {
          console.error("[lemlist webhook] auto-classify failed:", err);
        }
      });

      after(async () => {
        try {
          await fireOutboundWebhooks(workspaceId, {
            event: "reply_received",
            email: prospect.email,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            company: prospect.company,
            domain: prospect.domain,
            phone: prospect.phone ?? null,
            title: prospect.title ?? null,
            linkedinUrl: prospect.linkedinUrl ?? null,
            source: "Email",
            campaignName: normalized.campaignName ?? null,
            stepReplied: prospect.stepReplied ?? null,
            label: prospect.leadStatus ?? null,
            notes: prospect.notes ?? null,
            feedback: prospect.feedback ?? null,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[lemlist webhook] outbound webhook failed:", err);
        }
      });
    }

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });

    return NextResponse.json({
      status: "processed",
      threadId: thread.id,
      messageId: message.id,
    });
  } catch (error) {
    console.error("Lemlist webhook error:", error);

    try {
      const workspaceId = req.nextUrl.searchParams.get("workspace_id");
      if (workspaceId) {
        const pendingLog = await prisma.webhookLog.findFirst({
          where: { workspaceId, provider: "LEMLIST", status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });
        if (pendingLog) {
          await prisma.webhookLog.update({
            where: { id: pendingLog.id },
            data: {
              status: "FAILED",
              errorMessage:
                error instanceof Error ? error.message : "Unknown error",
              processedAt: new Date(),
            },
          });
        }
      }
    } catch {
      // Don't mask original error
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
