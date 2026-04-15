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
    // Per-integration budgets. The function-level cap is 300s; we give each
    // integration up to 240s so sync + enrichment both have room. With
    // Promise.allSettled below they all run in parallel, so the wall-clock
    // for the whole cron is roughly max(individual times), not sum.
    const SYNC_BUDGET_MS = 120_000;
    const ENRICH_BUDGET_MS = 120_000;

    // Process every integration in parallel. Per-API-key rate limiters in
    // the sync/enrich modules ensure two workspaces sharing a provider
    // (e.g. two Instantly accounts) don't trip over each other's pacing.
    const results = await Promise.allSettled(
      integrations.map(async (integration) => {
        // Skip if a manual sync is genuinely in flight; recover stale locks
        // (>6min, just above Vercel's 300s function timeout).
        const config = (integration.config as Record<string, unknown>) ?? {};
        let needsConfigUpdate = false;

        if (config.syncRunning) {
          const startedAt = config.syncStartedAt as string | undefined;
          const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
          if (elapsed < 6 * 60 * 1000) {
            console.log(`[cron] Skipping ${integration.id} — sync running (${Math.round(elapsed / 1000)}s)`);
            return { skipped: true };
          }
          console.log(`[cron] Clearing stale sync lock on ${integration.id} (${Math.round(elapsed / 1000)}s old)`);
          delete config.syncRunning;
          delete config.syncStartedAt;
          needsConfigUpdate = true;
        }

        if (config.enrichRunning) {
          const startedAt = config.enrichStartedAt as string | undefined;
          const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
          if (elapsed > 10 * 60 * 1000) {
            console.log(`[cron] Clearing stale enrich lock on ${integration.id} (${Math.round(elapsed / 1000)}s old)`);
            delete config.enrichRunning;
            delete config.enrichStartedAt;
            needsConfigUpdate = true;
          }
        }

        if (needsConfigUpdate) {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { config: config as object },
          });
        }

        try {
          console.log(`[cron] Syncing ${integration.provider} ${integration.id} (sync ${SYNC_BUDGET_MS / 1000}s + enrich ${ENRICH_BUDGET_MS / 1000}s)`);

          const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
          const result = await syncFn(integration.id, SYNC_BUDGET_MS);

          console.log(
            `[cron] ${integration.provider} ${integration.id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`
          );

          // Auto-enrich Instantly after EVERY sync — lead statuses change
          // on the provider side (e.g., lead marks Interested) even when
          // no new messages arrive, so we need to pick those up continuously.
          if (integration.provider === "INSTANTLY") {
            try {
              await enrichFromInstantly(integration.id, ENRICH_BUDGET_MS);
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

          return { processed: true };
        } catch (err) {
          console.error(`[cron] Sync failed for ${integration.id}:`, err instanceof Error ? err.message : err);
          return { error: true };
        }
      })
    );

    const processed = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { processed?: boolean }).processed
    ).length;
    const skipped = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { skipped?: boolean }).skipped
    ).length;

    const elapsed = Date.now() - startTime;
    console.log(`[cron] Done in ${Math.round(elapsed / 1000)}s — ${processed} processed, ${skipped} skipped, ${integrations.length} total`);
  });

  return NextResponse.json({
    status: "triggered",
    integrations: integrations.length,
  });
}
