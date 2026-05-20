import { prisma } from "@/lib/prisma";

type OutboundEvent = "reply_received" | "lead_tagged";

interface OutboundPayload {
  event: OutboundEvent;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  domain: string | null;
  campaignName: string | null;
  label: string | null;
  timestamp: string;
}

export async function fireOutboundWebhooks(
  workspaceId: string,
  payload: OutboundPayload
): Promise<void> {
  const hooks = await prisma.outboundWebhook.findMany({
    where: { workspaceId, isActive: true },
    select: { url: true },
  });

  if (hooks.length === 0) return;

  await Promise.allSettled(
    hooks.map((h) =>
      fetch(h.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    )
  );
}
