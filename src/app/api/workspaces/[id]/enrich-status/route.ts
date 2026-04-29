import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

// Lightweight polling endpoint used by the EnrichDialog while a background
// job is running. Returns whether the workspace's enrichment job is currently
// running so the UI can show a spinner / refetch on completion.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { id } = await params;
  if (id !== workspaceId) {
    return NextResponse.json({ error: "Workspace mismatch" }, { status: 403 });
  }

  const ws = await prisma.workspace.findUnique({
    where: { id },
    select: { config: true },
  });
  const cfg = (ws?.config as Record<string, unknown>) ?? {};
  const running = !!cfg.enrichRunning;
  const startedAt = (cfg.enrichStartedAt as string | undefined) ?? null;

  return NextResponse.json({ running, startedAt });
}
