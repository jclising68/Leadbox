import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";
import { updateSyncProgress } from "@/services/sync-progress";
import { after } from "next/server";
import { workspaceJson } from "@/lib/api-response";

// Allow up to 300s for the after() sync work (Vercel Pro max)
export const maxDuration = 300;

// Check if a sync is already running (DB-backed, serverless-safe)
async function isSyncRunning(integrationId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = (integration?.config as Record<string, unknown>) ?? {};
  if (!config.syncRunning) return false;

  // If sync started more than 2 minutes ago, consider it stale.
  // On Vercel, after() background work can be killed at the 60s timeout
  // without running finally blocks, so the flag may never be cleared.
  // 2 minutes gives enough margin for legitimate syncs while recovering
  // quickly from abandoned locks.
  const startedAt = config.syncStartedAt as string | undefined;
  if (startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    if (elapsed > 6 * 60 * 1000) return false; // Stale — allow restart (>Vercel 300s maxDuration)
  }

  return true;
}

async function markSyncRunning(integrationId: string, running: boolean, errorMessage?: string | null) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = ((integration?.config as Record<string, unknown>) ?? {});

  if (running) {
    // Starting a fresh attempt — wipe leftover state from any prior run so
    // the user sees a clean "Queued..." state instead of a ghost error or
    // a frozen progress beat from a previous after() that died.
    config.syncRunning = true;
    config.syncStartedAt = new Date().toISOString();
    delete config.lastError;
    delete config.lastErrorAt;
    delete config.syncProgress;
  } else {
    delete config.syncRunning;
    delete config.syncStartedAt;
    if (errorMessage !== undefined) {
      if (errorMessage) {
        config.lastError = errorMessage;
        config.lastErrorAt = new Date().toISOString();
      } else {
        delete config.lastError;
        delete config.lastErrorAt;
      }
    }
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

  if (await isSyncRunning(id)) {
    return NextResponse.json({
      success: true,
      status: "already_running",
      message: "Sync is already in progress",
    });
  }

  // Mark sync as running and schedule background work
  await markSyncRunning(id, true);
  // Show a "queued" beat immediately so the UI can render progress before
  // the background sync boots.
  await updateSyncProgress(id, {
    stage: "queued",
    message: "Queued — starting soon",
    percent: 0,
  });

  after(async () => {
    const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
    let syncError: string | null = null;
    try {
      const result = await syncFn(integration.id);
      console.log(`[sync] Completed for ${id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);

      // Auto-run enrichment after Instantly sync
      if (integration.provider === "INSTANTLY") {
        console.log(`[sync] Starting auto-enrichment for ${id}...`);
        try {
          const enrichResult = await enrichFromInstantly(integration.id);
          console.log(`[sync] Auto-enrichment done for ${id}: ${enrichResult.enriched} enriched, ${enrichResult.imported} imported`);
        } catch (err) {
          console.error(`[sync] Auto-enrichment failed for ${id}:`, err instanceof Error ? err.message : err);
        }
      }

      // Auto-archive threads older than 2026-01-01
      try {
        const archived = await prisma.thread.updateMany({
          where: {
            workspaceId: integration.workspaceId,
            status: "OPEN",
            lastMessageAt: { lt: new Date("2026-01-01T00:00:00.000Z") },
          },
          data: { status: "ARCHIVED" },
        });
        if (archived.count > 0) {
          console.log(`[sync] Auto-archived ${archived.count} pre-2026 threads`);
        }
      } catch (err) {
        console.error(`[sync] Auto-archive failed:`, err instanceof Error ? err.message : err);
      }
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
      console.error(`[sync] Failed for ${id}:`, syncError);
    } finally {
      await markSyncRunning(id, false, syncError);
    }
  });

  return NextResponse.json({
    success: true,
    status: "started",
    message: "Sync started in the background. This may take several minutes for large accounts.",
  });
}

// GET to check sync status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
    select: { id: true, lastSyncAt: true, config: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const config = (integration.config as Record<string, unknown>) ?? {};

  // Treat locks older than 6 minutes as stale (after() may have been killed).
  // Slightly above Vercel's 300s maxDuration so legit long syncs aren't
  // misreported as finished.
  let syncing = !!config.syncRunning;
  if (syncing && config.syncStartedAt) {
    const elapsed = Date.now() - new Date(config.syncStartedAt as string).getTime();
    if (elapsed > 6 * 60 * 1000) syncing = false;
  }

  return workspaceJson({
    syncing,
    lastSyncAt: integration.lastSyncAt,
  });
}
