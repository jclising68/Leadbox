import { prisma } from "@/lib/prisma";

export type SyncProgress = {
  stage: string; // short: "fetching_pages" | "processing" | "enriching" | "done"
  message: string; // human: "Fetching page 3 of ~10"
  current?: number;
  total?: number;
  percent: number; // 0..100
  updatedAt: string; // ISO
};

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

export async function clearSyncProgress(integrationId: string) {
  try {
    const row = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { config: true },
    });
    const config = ((row?.config as Record<string, unknown>) ?? {});
    delete config.syncProgress;
    await prisma.integration.update({
      where: { id: integrationId },
      data: { config: config as object },
    });
  } catch (err) {
    console.warn(
      `[sync-progress] Failed to clear progress for ${integrationId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
