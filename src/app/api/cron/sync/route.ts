import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";

const MAX_DURATION_MS = 55_000; // Stay under 60s Vercel Hobby limit

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results: { id: string; provider: string; synced: number; skipped: number; errors: number }[] = [];

  // Fetch all active integrations across all workspaces
  const integrations = await prisma.integration.findMany({
    where: { isActive: true },
    select: { id: true, provider: true, workspaceId: true, config: true },
    orderBy: { lastSyncAt: "asc" }, // Prioritize least-recently synced
  });

  for (const integration of integrations) {
    // Check time budget
    if (Date.now() - startTime > MAX_DURATION_MS) {
      console.log(`[cron] Time budget exhausted after ${results.length} integrations`);
      break;
    }

    // Skip if manual sync is running
    const config = (integration.config as Record<string, unknown>) ?? {};
    if (config.syncRunning) {
      console.log(`[cron] Skipping ${integration.id} — manual sync running`);
      continue;
    }

    try {
      console.log(`[cron] Syncing ${integration.provider} integration ${integration.id}...`);

      const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
      const result = await syncFn(integration.id);

      results.push({
        id: integration.id,
        provider: integration.provider,
        ...result,
      });

      // Auto-enrich Instantly after sync
      if (integration.provider === "INSTANTLY" && result.synced > 0) {
        try {
          await enrichFromInstantly(integration.id);
        } catch (err) {
          console.error(`[cron] Enrichment failed for ${integration.id}:`, err instanceof Error ? err.message : err);
        }
      }

      // Auto-archive pre-2026 threads
      await prisma.thread.updateMany({
        where: {
          workspaceId: integration.workspaceId,
          status: "OPEN",
          lastMessageAt: { lt: new Date("2026-01-01T00:00:00.000Z") },
        },
        data: { status: "ARCHIVED" },
      });
    } catch (err) {
      console.error(`[cron] Sync failed for ${integration.id}:`, err instanceof Error ? err.message : err);
      results.push({
        id: integration.id,
        provider: integration.provider,
        synced: 0,
        skipped: 0,
        errors: 1,
      });
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[cron] Sync complete in ${Math.round(elapsed / 1000)}s — ${results.length}/${integrations.length} integrations processed`);

  return NextResponse.json({
    processed: results.length,
    total: integrations.length,
    elapsed: `${Math.round(elapsed / 1000)}s`,
    results,
  });
}
