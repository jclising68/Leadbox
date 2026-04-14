import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";

export const maxDuration = 300;

/**
 * Cron-triggered sync. Returns 200 immediately and runs the actual sync
 * work via `after()` (Vercel's `waitUntil`) so the HTTP response doesn't
 * depend on the sync finishing within the function timeout.
 */
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

  // Fetch all active integrations across all workspaces
  const integrations = await prisma.integration.findMany({
    where: { isActive: true },
    select: { id: true, provider: true, workspaceId: true, config: true },
    orderBy: { lastSyncAt: "asc" }, // Prioritize least-recently synced
  });

  // Return immediately — actual sync runs in background via after()
  after(async () => {
    const startTime = Date.now();
    const MAX_DURATION_MS = 270_000;
    let processed = 0;

    for (const integration of integrations) {
      // Check time budget
      if (Date.now() - startTime > MAX_DURATION_MS) {
        console.log(`[cron] Time budget exhausted after ${processed} integrations`);
        break;
      }

      // Skip if manual sync is running (but recover stale locks > 5 min)
      const config = (integration.config as Record<string, unknown>) ?? {};
      if (config.syncRunning) {
        const startedAt = config.syncStartedAt as string | undefined;
        const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
        if (elapsed < 2 * 60 * 1000) {
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
        const remaining = MAX_DURATION_MS - (Date.now() - startTime);
        const perIntegrationBudget = Math.min(remaining, 120_000);
        console.log(`[cron] Syncing ${integration.provider} integration ${integration.id} (budget: ${Math.round(perIntegrationBudget / 1000)}s)...`);

        const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
        const result = await syncFn(integration.id, perIntegrationBudget);
        processed++;

        console.log(
          `[cron] ${integration.provider} ${integration.id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`
        );

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
        processed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[cron] Sync complete in ${Math.round(elapsed / 1000)}s — ${processed}/${integrations.length} integrations processed`);
  });

  return NextResponse.json({
    status: "triggered",
    integrations: integrations.length,
  });
}
