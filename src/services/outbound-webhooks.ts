import { prisma } from "@/lib/prisma";

type OutboundEvent = "reply_received" | "lead_tagged";

interface OutboundPayload {
  event: OutboundEvent;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  domain: string | null;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
  source: string | null;
  campaignName: string | null;
  stepReplied: string | null;
  label: string | null;
  replyText: string | null;
  notes: string | null;
  feedback: string | null;
  timestamp: string;
}

async function logDelivery(
  workspaceId: string,
  webhookUrl: string,
  event: string,
  success: boolean,
  statusCode?: number,
  errorMessage?: string
): Promise<void> {
  try {
    await prisma.outboundWebhookDelivery.create({
      data: {
        workspaceId,
        webhookUrl,
        event,
        success,
        statusCode: statusCode ?? null,
        errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
      },
    });
  } catch {
    // Never let logging failures surface to callers
  }
}

export async function fireOutboundWebhooks(
  workspaceId: string,
  payload: OutboundPayload
): Promise<void> {
  const hooks = await prisma.outboundWebhook.findMany({
    where: { workspaceId, isActive: true },
    select: { url: true, triggers: true, tagFilters: true },
  });

  if (hooks.length === 0) return;

  const matching = hooks.filter((h) => {
    const triggers = h.triggers ?? [];
    if (triggers.length > 0 && !triggers.includes(payload.event)) return false;

    // For lead_tagged: if tagFilters is set, only fire if the label matches
    if (payload.event === "lead_tagged") {
      const tagFilters = h.tagFilters ?? [];
      if (tagFilters.length > 0) {
        return !!(payload.label && tagFilters.includes(payload.label));
      }
    }
    return true;
  });

  if (matching.length === 0) return;

  // For lead_tagged: put the label name in event, drop the separate label field
  const outgoing =
    payload.event === "lead_tagged" && payload.label
      ? (({ label: _label, ...rest }) => ({ ...rest, event: _label }))(payload)
      : payload;

  // The event name to log (for lead_tagged, use the label value as the event string)
  const loggedEvent =
    payload.event === "lead_tagged" && payload.label
      ? payload.label
      : payload.event;

  await Promise.allSettled(
    matching.map(async (h) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(h.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(outgoing),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          let body = "";
          try {
            body = await response.text();
          } catch {
            // ignore
          }
          await logDelivery(
            workspaceId,
            h.url,
            loggedEvent,
            false,
            response.status,
            body || `HTTP ${response.status}`
          );
        } else {
          await logDelivery(workspaceId, h.url, loggedEvent, true, response.status);
        }
      } catch (err) {
        clearTimeout(timer);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        await logDelivery(workspaceId, h.url, loggedEvent, false, undefined, errorMessage);
      }
    })
  );
}
