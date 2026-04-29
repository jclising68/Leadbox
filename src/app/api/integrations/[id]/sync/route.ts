import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { syncInstantly } from "@/services/instantly-sync";
import { syncHeyreach } from "@/services/heyreach-sync";
import { markSyncStartedFresh, STALE_LOCK_MS, updateSyncProgress } from "@/services/sync-progress";
import { after } from "next/server";
import { workspaceJson } from "@/lib/api-response";

// Vercel Pro max. after() sync work needs the full window.
export const maxDuration = 300;

// DB-backed lock so parallel requests across serverless invocations see the
// same state. Locks older than STALE_LOCK_MS self-heal (killed after(), HMR).
async function isSyncRunning(integrationId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });

  const config = (integration?.config as Record<string, unknown>) ?? {};
  if (!config.syncRunning) return false;

  const startedAt = config.syncStartedAt as string | undefined;
  if (startedAt && Date.now() - new Date(startedAt).getTime() > STALE_LOCK_MS) {
    return false;
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
    markSyncStartedFresh(config);
  } else {
    delete config.syncRunning;
    delete config.syncStartedAt;
    if (errorMessage) {
      config.lastError = errorMessage;
      config.lastErrorAt = new Date().toISOString();
    } else {
      delete config.lastError;
      delete config.lastErrorAt;
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

  if (integration.provider !== "INSTANTLY" && integration.provider !== "HEYREACH") {
    return NextResponse.json(
      { error: `Sync is not supported for ${integration.provider}. Only Instantly and HeyReach pull threads/messages.` },
      { status: 400 },
    );
  }

  if (await isSyncRunning(id)) {
    return NextResponse.json({
      success: true,
      status: "already_running",
      message: "Sync is already in progress",
    });
  }

  await markSyncRunning(id, true);
  await updateSyncProgress(id, {
    stage: "queued",
    message: "Queued — starting soon",
    percent: 0,
  });

  after(async () => {
    // Manual sync runs sync-only; enrichment goes through its own route / cron
    // because sync + enrich together exceed Vercel's 300s function limit.
    // Provider was validated above, so this is safe.
    const syncFn = integration.provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
    let syncError: string | null = null;
    try {
      const result = await syncFn(integration.id);
      console.log(`[sync] Completed for ${id}: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);

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
      syncError = err instanceof Error ? err.message : String(err);
      console.error(`[sync] Failed for ${id}:`, syncError);
    } finally {
      await markSyncRunning(id, false, syncError);
    }

    // Chain the next backfill run so one click walks large histories without
    // waiting 15min for cron. Cap at MAX_HOPS to prevent runaway recursion.
    if (!syncError && integration.provider === "INSTANTLY") {
      const fresh = await prisma.integration.findUnique({
        where: { id: integration.id },
        select: { config: true },
      });
      const cfg = (fresh?.config as Record<string, unknown>) ?? {};
      const MAX_HOPS = 5;
      if (!cfg.instantlyBackfillComplete && cfg.instantlyBackfillCursor) {
        const hop = Number(cfg.backfillChainHop ?? 0);
        if (hop < MAX_HOPS) {
          cfg.backfillChainHop = hop + 1;
          await prisma.integration.update({
            where: { id: integration.id },
            data: { config: cfg as object },
          });
          console.log(`[sync] Chaining backfill run ${hop + 1}/${MAX_HOPS} for ${id}`);
          fetch(`${req.nextUrl.origin}/api/integrations/${id}/sync`, {
            method: "POST",
            headers: {
              "x-workspace-id": integration.workspaceId,
              cookie: req.headers.get("cookie") ?? "",
            },
          }).catch((e) => console.error("[sync] Chain trigger failed:", e));
        } else {
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
