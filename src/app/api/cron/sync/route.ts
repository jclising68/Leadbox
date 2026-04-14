import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";

export const maxDuration = 60;
const MAX_DURATION_MS = 55_000; // Stay under 60s Vercel limit

export async function GET(req: NextRequest) {
  // Verify cron secret — fail closed if not configured
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron] CRON_SECRET not configured — rejecting request");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
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

    // Skip if manual sync is running (but recover stale locks > 5 min)
    const config = (integration.config as Record<string, unknown>) ?? {};
    if (config.syncRunning) {
      const startedAt = config.syncStartedAt as string | undefined;
      const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
      if (elapsed < 5 * 60 * 1000) {
        console.log(`[cron] Skipping ${integration.id} — manual sync running`);
        continue;
      }
      // Stale lock — clean it up
      console.log(`[cron] Clearing stale sync lock on ${integration.id} (${Math.round(elapsed / 1000)}s old)`);
      const c = { ...config };
      delete c.syncRunning;
      delete c.syncStartedAt;
      await prisma.integration.update({
        where: { id: integration.id },
        data: { config: c as object },
      });
    }

    try {
      // Give each integration a share of remaining time
      const remaining = MAX_DURATION_MS - (Date.now() - startTime);
      const perIntegrationBudget = Math.min(remaining, 25_000); // Max 25s per integration
      console.log(`[cron] Syncing ${integration.provider} integration ${integration.id} (budget: ${Math.round(perIntegrationBudget / 1000)}s)...`);

      const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
      const result = await syncFn(integration.id, perIntegrationBudget);

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
