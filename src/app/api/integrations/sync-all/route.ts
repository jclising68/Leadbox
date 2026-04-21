import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";
import { updateSyncProgress } from "@/services/sync-progress";

export const maxDuration = 300;

// Skip a sync if the integration was synced this recently
const FRESH_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
// Treat sync locks older than this as stale (after() may have been killed).
// Slightly above Vercel's 300s maxDuration so legit long syncs aren't aborted.
const STALE_LOCK_MS = 6 * 60 * 1000; // 6 minutes

/**
 * Trigger background sync for every active integration in the workspace.
 * Used by the workspace layout when a user opens a workspace so we always
 * pull the latest data from Instantly / HeyReach.
 *
 * Idempotent + cheap: returns immediately, work runs via `after()`.
 * Skips integrations that are currently syncing OR were synced very recently.
 */
type SyncResult = {
  integrationId: string;
  provider: string;
  status: "triggered" | "skipped_running" | "skipped_fresh" | "skipped_inactive";
  lastSyncAt: string | null;
  lastError?: string | null;
};

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  // Include inactive integrations so the UI can show why they didn't sync
  // (otherwise Stable Sea's broken integration was invisible).
  const integrations = await prisma.integration.findMany({
    where: { workspaceId: workspaceId! },
    select: { id: true, provider: true, lastSyncAt: true, isActive: true, config: true },
  });

  const results: SyncResult[] = [];

  for (const integration of integrations) {
    const config = (integration.config as Record<string, unknown>) ?? {};
    const lastError = (config.lastError as string | undefined) ?? null;

    if (!integration.isActive) {
      results.push({
        integrationId: integration.id,
        provider: integration.provider,
        status: "skipped_inactive",
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
        lastError,
      });
      continue;
    }

    // Already syncing — skip, but recover stale locks (function killed
    // mid-run on Vercel without running `finally`).
    if (config.syncRunning) {
      const startedAt = config.syncStartedAt as string | undefined;
      const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
      if (elapsed < STALE_LOCK_MS) {
        results.push({
          integrationId: integration.id,
          provider: integration.provider,
          status: "skipped_running",
          lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
          lastError,
        });
        continue;
      }
      // Stale — fall through to re-trigger after clearing
      delete config.syncRunning;
      delete config.syncStartedAt;
    }

    // Synced very recently — skip to avoid hammering provider APIs
    if (
      integration.lastSyncAt &&
      Date.now() - new Date(integration.lastSyncAt).getTime() < FRESH_WINDOW_MS
    ) {
      results.push({
        integrationId: integration.id,
        provider: integration.provider,
        status: "skipped_fresh",
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
        lastError,
      });
      continue;
    }

    results.push({
      integrationId: integration.id,
      provider: integration.provider,
      status: "triggered",
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      lastError,
    });

    // Mark running BEFORE the after() call so a quick refresh doesn't
    // double-trigger. Also wipe leftover state so the UI shows a fresh
    // "Queued..." instead of a ghost error or a frozen progress beat from
    // an earlier after() that died.
    const freshConfig: Record<string, unknown> = { ...config };
    freshConfig.syncRunning = true;
    freshConfig.syncStartedAt = new Date().toISOString();
    delete freshConfig.lastError;
    delete freshConfig.lastErrorAt;
    delete freshConfig.syncProgress;
    await prisma.integration.update({
      where: { id: integration.id },
      data: { config: freshConfig as object },
    });

    // Show a "queued" beat immediately so the UI has something to render
    // before the background sync boots.
    await updateSyncProgress(integration.id, {
      stage: "queued",
      message: "Queued — starting soon",
      percent: 0,
    });

    after(async () => {
      const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
      let syncError: string | null = null;
      try {
        const result = await syncFn(integration.id);
        console.log(
          `[sync-all] ${integration.provider} ${integration.id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`
        );
        // Always enrich Instantly — lead statuses change on the provider
        // side even when no new messages arrive.
        if (integration.provider === "INSTANTLY") {
          try {
            await enrichFromInstantly(integration.id);
          } catch (err) {
            console.error(`[sync-all] enrich failed for ${integration.id}:`, err);
          }
        }
      } catch (err) {
        syncError = err instanceof Error ? err.message : String(err);
        console.error(`[sync-all] sync failed for ${integration.id}:`, err);
      } finally {
        const fresh = await prisma.integration.findUnique({
          where: { id: integration.id },
          select: { config: true },
        });
        const c = ((fresh?.config as Record<string, unknown>) ?? {});
        delete c.syncRunning;
        delete c.syncStartedAt;
        // Persist last error (or clear it on success) so future /status
        // calls and the UI can see why a workspace stopped syncing.
        if (syncError) {
          c.lastError = syncError;
          c.lastErrorAt = new Date().toISOString();
        } else {
          delete c.lastError;
          delete c.lastErrorAt;
        }
        await prisma.integration.update({
          where: { id: integration.id },
          data: { config: c as object, lastSyncAt: new Date() },
        });
      }
    });
  }

  const triggered = results.filter((r) => r.status === "triggered").length;
  const skipped = results.length - triggered;

  return NextResponse.json({
    triggered,
    skipped,
    total: results.length,
    results,
  });
}
