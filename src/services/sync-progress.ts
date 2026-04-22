import { prisma } from "@/lib/prisma";

export type SyncProgress = {
  stage: string; // short: "fetching_pages" | "processing" | "enriching" | "done"
  message: string; // human: "Fetching page 3 of ~10"
  current?: number;
  total?: number;
  percent: number; // 0..100
  updatedAt: string; // ISO
};

// Treat sync locks older than this as stale. Sits just above Vercel's
// 300s function timeout so legit long syncs aren't aborted, but short
// enough that a killed `after()` heals quickly on the next trigger.
export const STALE_LOCK_MS = 6 * 60 * 1000;

// Mutates an integration.config object to mark a fresh sync attempt and
// wipe leftover state from any prior run (errors + ghost progress beats).
// Shared by the per-integration sync route and sync-all, which used to
// inline identical copies and drift apart.
export function markSyncStartedFresh(config: Record<string, unknown>) {
  config.syncRunning = true;
  config.syncStartedAt = new Date().toISOString();
  delete config.lastError;
  delete config.lastErrorAt;
  delete config.syncProgress;
}

export async function updateSyncProgress(
  integrationId: string,
  progress: Omit<SyncProgress, "updatedAt"> & { updatedAt?: string },
) {
  try {
    const row = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { config: true },
    });
    const config = ((row?.config as Record<string, unknown>) ?? {});
    config.syncProgress = {
      ...progress,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    };
    await prisma.integration.update({
      where: { id: integrationId },
      data: { config: config as object },
    });
  } catch (err) {
    // Progress reporting must never break sync — log and continue.
    console.warn(
      `[sync-progress] Failed to update progress for ${integrationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

