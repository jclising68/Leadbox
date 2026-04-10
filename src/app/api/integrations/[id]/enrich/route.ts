import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { enrichFromInstantly } from "@/services/lead-enrichment";
import { syncHeyreach } from "@/services/heyreach-sync";
import { after } from "next/server";

async function isEnrichRunning(integrationId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = (integration?.config as Record<string, unknown>) ?? {};
  if (!config.enrichRunning) return false;

  const startedAt = config.enrichStartedAt as string | undefined;
  if (startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    if (elapsed > 10 * 60 * 1000) return false;
  }

  return true;
}

async function markEnrichRunning(integrationId: string, running: boolean) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = ((integration?.config as Record<string, unknown>) ?? {});

  if (running) {
    config.enrichRunning = true;
    config.enrichStartedAt = new Date().toISOString();
  } else {
    delete config.enrichRunning;
    delete config.enrichStartedAt;
  }

  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: config as object },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  if (await isEnrichRunning(id)) {
    return NextResponse.json({ success: true, status: "already_running" });
  }

  await markEnrichRunning(id, true);

  after(async () => {
    try {
      if (integration.provider === "INSTANTLY") {
        const result = await enrichFromInstantly(integration.id);
        console.log(`[enrich] Done for ${id}: ${result.enriched} enriched`);
      } else {
        // HeyReach enrichment runs as part of sync (conversations include profile data)
        const result = await syncHeyreach(integration.id);
        console.log(`[enrich] HeyReach re-sync for enrichment ${id}: ${result.synced} synced`);
      }
    } catch (e) {
      console.error(`[enrich] Failed for ${id}:`, e instanceof Error ? e.message : e);
    } finally {
      await markEnrichRunning(id, false);
    }
  });

  return NextResponse.json({
    success: true,
    status: "started",
    message: "Enrichment started in background. Lead data will be updated shortly.",
  });
}
