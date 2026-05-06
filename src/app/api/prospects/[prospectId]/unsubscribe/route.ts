import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { decrypt } from "@/lib/crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ prospectId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { prospectId } = await params;

  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId: workspaceId! },
    select: {
      id: true,
      email: true,
      isUnsubscribed: true,
      thread: {
        select: {
          messages: {
            where: { campaignId: { not: null } },
            orderBy: { receivedAt: "desc" },
            take: 1,
            select: { campaignId: true },
          },
        },
      },
    },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  if (prospect.isUnsubscribed) {
    return NextResponse.json({ message: "Already unsubscribed" });
  }

  await prisma.prospect.update({
    where: { id: prospectId },
    data: { isUnsubscribed: true, unsubscribedAt: new Date() },
  });

  // Sync to Instantly for email contacts that have a campaign association
  const campaignId = prospect.thread?.messages[0]?.campaignId;
  if (prospect.email && campaignId) {
    const integrations = await prisma.integration.findMany({
      where: { workspaceId: workspaceId!, provider: "INSTANTLY", isActive: true },
      select: { apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true },
    });

    const results = await Promise.allSettled(
      integrations.map(async (integration) => {
        const apiKey = decrypt(
          integration.apiKeyEncrypted,
          integration.apiKeyIv,
          integration.apiKeyTag
        );
        const res = await fetch(
          "https://api.instantly.ai/api/v1/lead/update/status",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              campaign_id: campaignId,
              email: prospect.email,
              new_status: "Unsubscribed",
            }),
          }
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Instantly API ${res.status}: ${body}`);
        }
      })
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.error(
        "[unsubscribe] Instantly sync partial failure:",
        failures.map((f) => (f as PromiseRejectedResult).reason)
      );
    }
  }

  return NextResponse.json({ success: true });
}
