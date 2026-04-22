import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { markSyncStartedFresh, STALE_LOCK_MS, updateSyncProgress } from "@/services/sync-progress";
import { after } from "next/server";
import { workspaceJson } from "@/lib/api-response";

// Allow up to 300s for the after() sync work (Vercel Pro max)
export const maxDuration = 300;

// Check if a sync is already running (DB-backed, serverless-safe).
// Treats locks older than STALE_LOCK_MS as abandoned so a killed after()
// (Vercel timeout, dev HMR) self-heals on the next trigger.
async function isSyncRunning(integrationId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = (integration?.config as Record<string, unknown>) ?? {};
  if (!config.syncRunning) return false;

  const startedAt = config.syncStartedAt as string | undefined;
  if (startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    if (elapsed > STALE_LOCK_MS) return false;
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
    // Fresh attempt — wipes leftover error/progress from any prior run
    // so the UI shows a clean "Queued..." instead of a ghost.
    markSyncStartedFresh(config);
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
      // Manual Sync runs ONLY the sync phase. Enrichment is triggered
      // explicitly by the user (via the Enrich button → /api/integrations/
      // [id]/enrich) or by cron. Previously this route also called
      // enrichFromInstantly() inline, but sync(250s) + enrich(120s) = 370s
      // exceeded Vercel's 300s function limit, so enrichment consistently
      // died mid-run at 2% and stuck the lock.
      const result = await syncFn(integration.id);
      console.log(`[sync] Completed for ${id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);

      // Auto-archive threads older than 2026-01-01 — preserves existing
      // behavior of collapsing ancient inbox state after a fresh sync.
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

    // Auto-chain Instantly backfill. One click should walk the full history
    // even for accounts with thousands of emails — without chaining, the
    // user has to wait 15 min for cron to pick up the saved cursor, and is
    // told "sync finished" while history is still incomplete. Bail if the
    // flag's set, if there's no cursor, or if the chain hop count is at its
    // cap (to prevent runaway recursion on a stuck cursor).
    if (!syncError && integration.provider === "INSTANTLY") {
      const fresh = await prisma.integration.findUnique({
        where: { id: integration.id },
        select: { config: true },
      });
      const cfg = (fresh?.config as Record<string, unknown>) ?? {};
      if (!cfg.instantlyBackfillComplete && cfg.instantlyBackfillCursor) {
        const hop = Number(cfg.backfillChainHop ?? 0);
        const MAX_HOPS = 5;
        if (hop < MAX_HOPS) {
          cfg.backfillChainHop = hop + 1;
          await prisma.integration.update({
            where: { id: integration.id },
            data: { config: cfg as object },
          });
          const origin = req.nextUrl.origin;
          console.log(`[sync] Chaining backfill run ${hop + 1}/${MAX_HOPS} for ${id}`);
          // Fire-and-forget — the next function picks up from the saved cursor.
          fetch(`${origin}/api/integrations/${id}/sync`, {
            method: "POST",
            headers: {
              "x-workspace-id": integration.workspaceId,
              cookie: req.headers.get("cookie") ?? "",
            },
          }).catch((e) => console.error("[sync] Chain trigger failed:", e));
        } else {
          // Hop cap reached — clear so cron or next manual click can resume.
          delete cfg.backfillChainHop;
          await prisma.integration.update({
            where: { id: integration.id },
            data: { config: cfg as object },
          });
          console.log(`[sync] Backfill chain hop cap reached for ${id}; cron will continue.`);
        }
      } else if (cfg.backfillChainHop) {
        delete cfg.backfillChainHop;
        await prisma.integration.update({
          where: { id: integration.id },
          data: { config: cfg as object },
        });
      }
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

  // Treat locks older than STALE_LOCK_MS as stale — a killed after() on
  // Vercel never runs its finally so the flag would otherwise stick.
  let syncing = !!config.syncRunning;
  if (syncing && config.syncStartedAt) {
    const elapsed = Date.now() - new Date(config.syncStartedAt as string).getTime();
    if (elapsed > STALE_LOCK_MS) syncing = false;
  }

  return workspaceJson({
    syncing,
    lastSyncAt: integration.lastSyncAt,
  });
}
