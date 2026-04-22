import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

type PatchBody = {
  isActive?: boolean;
  clearSyncLock?: boolean;
  clearError?: boolean;
  /** ISO date — pushes the backfill horizon back so the next sync walks
   *  older history. Clears backfillComplete + cursor so the walk resumes. */
  expandBackfillTo?: string;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;
  const body: PatchBody = await req.json();

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
    select: { id: true, config: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const data: { isActive?: boolean; config?: object } = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;

  if (body.clearSyncLock || body.clearError || body.expandBackfillTo) {
    const config = ((integration.config as Record<string, unknown>) ?? {});
    if (body.clearSyncLock) {
      delete config.syncRunning;
      delete config.syncStartedAt;
      // Also clear any stale progress beat so the card shows a clean idle
      // state instead of a ghost "Queued..." from the killed attempt.
      delete config.syncProgress;
    }
    if (body.clearError) {
      delete config.lastError;
      delete config.lastErrorAt;
    }
    if (body.expandBackfillTo) {
      // Validate as an ISO date that's actually older than the current
      // cutoff — refuse to move the horizon FORWARD (which would hide
      // already-synced data from future delta logic).
      const next = new Date(body.expandBackfillTo);
      if (Number.isNaN(next.getTime())) {
        return NextResponse.json({ error: "expandBackfillTo is not a valid date" }, { status: 400 });
      }
      const currentIso = (config.backfillCutoffDate as string | undefined) ?? "2026-01-01T00:00:00.000Z";
      if (next >= new Date(currentIso)) {
        return NextResponse.json(
          { error: "expandBackfillTo must be earlier than current cutoff" },
          { status: 400 },
        );
      }
      config.backfillCutoffDate = next.toISOString();
      // Resume walking past the previous stopping point.
      config.instantlyBackfillComplete = false;
      delete config.instantlyBackfillCursor;
    }
    data.config = config as object;
  }

  const updated = await prisma.integration.update({
    where: { id },
    data,
    select: { id: true, isActive: true },
  });

  return NextResponse.json({ success: true, integration: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
    select: { id: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  await prisma.integration.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
