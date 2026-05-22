import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeInstantlyWebhook } from "@/services/webhook-processor";
import { resolveThread } from "@/services/thread-resolver";
import {
  classifyMessage,
  classificationToLabelName,
  applyAutoLabel,
} from "@/services/auto-labeler";
import { fireOutboundWebhooks } from "@/services/outbound-webhooks";

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

    // Validate webhook secret
    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId,
        provider: "INSTANTLY",
        webhookSecret: secret,
        isActive: true,
      },
    });

    if (!integration) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    const payload = (await req.json()) as Record<string, unknown>;

    // Log webhook
    const log = await prisma.webhookLog.create({
      data: {
        workspaceId,
        provider: "INSTANTLY",
        eventType: (payload.event_type as string) || "unknown",
        payload: payload as object,
        status: "PENDING",
      },
    });

    // Normalize and process
    const normalized = normalizeInstantlyWebhook(payload);

    if (!normalized.prospectEmail) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { status: "SKIPPED", errorMessage: "No prospect email", processedAt: new Date() },
      });
      return NextResponse.json({ status: "skipped", reason: "no_email" });
    }

    const { thread, message, prospect } = await resolveThread(
      workspaceId,
      integration.id,
      normalized
    );

    // Apply source label if available (e.g., lead_interested from Instantly)
    if (normalized.sourceLabel) {
      await applyAutoLabel(
        workspaceId,
        thread.id,
        normalized.sourceLabel,
        1.0,
        "WEBHOOK"
      );
    }

    // Auto-classify inbound messages with AI. Use Next.js `after()` so the
    // work runs under Vercel's `waitUntil` — a bare fire-and-forget .then()
    // gets killed when the lambda returns the response, which is why AI
    // labels sometimes never landed in production.
    if (normalized.direction === "INBOUND" && !normalized.sourceLabel) {
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
          console.error("[instantly webhook] auto-classify failed:", err);
        }
      });
    }

    // Fire outbound webhooks for every inbound reply — async, never blocks response
    if (normalized.direction === "INBOUND") {
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
            source: thread.channel === "LINKEDIN" ? "LinkedIn" : "Email",
            campaignName: normalized.campaignName ?? null,
            stepReplied: prospect.stepReplied ?? null,
            label: prospect.leadStatus ?? null,
            notes: prospect.notes ?? null,
            feedback: prospect.feedback ?? null,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[instantly webhook] outbound webhook failed:", err);
        }
      });
    }

    // Update log
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    // Update integration last sync
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
    console.error("Instantly webhook error:", error);

    // Try to update the webhook log to FAILED so it doesn't stay PENDING forever
    try {
      const url = req.nextUrl;
      const workspaceId = url.searchParams.get("workspace_id");
      if (workspaceId) {
        const pendingLog = await prisma.webhookLog.findFirst({
          where: { workspaceId, provider: "INSTANTLY", status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });
        if (pendingLog) {
          await prisma.webhookLog.update({
            where: { id: pendingLog.id },
            data: {
              status: "FAILED",
              errorMessage: error instanceof Error ? error.message : "Unknown error",
              processedAt: new Date(),
            },
          });
        }
      }
    } catch {
      // Don't let log update failure mask the original error
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
