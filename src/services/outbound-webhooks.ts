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
  notes: string | null;
  feedback: string | null;
  timestamp: string;
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

  await Promise.allSettled(
    matching.map((h) =>
      fetch(h.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outgoing),
      })
    )
  );
}
