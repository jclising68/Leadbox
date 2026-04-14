import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";

export const maxDuration = 60;

// Skip a sync if the integration was synced this recently
const FRESH_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Trigger background sync for every active integration in the workspace.
 * Used by the workspace layout when a user opens a workspace so we always
 * pull the latest data from Instantly / HeyReach.
 *
 * Idempotent + cheap: returns immediately, work runs via `after()`.
 * Skips integrations that are currently syncing OR were synced very recently.
 */
export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const integrations = await prisma.integration.findMany({
    where: { workspaceId: workspaceId!, isActive: true },
    select: { id: true, provider: true, lastSyncAt: true, config: true },
  });

  const triggered: string[] = [];
  const skipped: string[] = [];

  for (const integration of integrations) {
    const config = (integration.config as Record<string, unknown>) ?? {};

    // Already syncing — skip
    if (config.syncRunning) {
      skipped.push(integration.id);
      continue;
    }

    // Synced very recently — skip to avoid hammering provider APIs
    if (
      integration.lastSyncAt &&
      Date.now() - new Date(integration.lastSyncAt).getTime() < FRESH_WINDOW_MS
    ) {
      skipped.push(integration.id);
      continue;
    }

    triggered.push(integration.id);

    // Mark running BEFORE the after() call so a quick refresh doesn't
    // double-trigger.
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        config: {
          ...config,
          syncRunning: true,
          syncStartedAt: new Date().toISOString(),
        },
      },
    });

    after(async () => {
      const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
      try {
        const result = await syncFn(integration.id);
        console.log(
          `[sync-all] ${integration.provider} ${integration.id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`
        );
        if (integration.provider === "INSTANTLY" && result.synced > 0) {
          try {
            await enrichFromInstantly(integration.id);
          } catch (err) {
            console.error(`[sync-all] enrich failed for ${integration.id}:`, err);
          }
        }
      } catch (err) {
        console.error(`[sync-all] sync failed for ${integration.id}:`, err);
      } finally {
        const fresh = await prisma.integration.findUnique({
          where: { id: integration.id },
          select: { config: true },
        });
        const c = ((fresh?.config as Record<string, unknown>) ?? {});
        delete c.syncRunning;
        delete c.syncStartedAt;
        await prisma.integration.update({
          where: { id: integration.id },
          data: { config: c as object, lastSyncAt: new Date() },
        });
      }
    });
  }

  return NextResponse.json({
    triggered: triggered.length,
    skipped: skipped.length,
    total: integrations.length,
  });
}
