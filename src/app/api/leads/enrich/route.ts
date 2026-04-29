import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { enrichProspects, type EnrichField } from "@/services/enrichment";

export const maxDuration = 300;

const VALID_FIELDS: EnrichField[] = ["phone", "title", "linkedinUrl", "verifiedEmail", "company"];

// Stale-window for the enrichRunning lock. If a run started >10min ago and
// nothing cleared the flag, treat it as dead (Vercel function timeout, crash).
const STALE_LOCK_MS = 10 * 60 * 1000;

async function isEnrichRunning(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { config: true },
  });
  const cfg = (ws?.config as Record<string, unknown>) ?? {};
  if (!cfg.enrichRunning) return false;
  const startedAt = cfg.enrichStartedAt as string | undefined;
  if (startedAt) {
    if (Date.now() - new Date(startedAt).getTime() > STALE_LOCK_MS) return false;
  }
  return true;
}

async function setEnrichRunning(workspaceId: string, running: boolean) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { config: true },
  });
  const cfg = ((ws?.config as Record<string, unknown>) ?? {});
  if (running) {
    cfg.enrichRunning = true;
    cfg.enrichStartedAt = new Date().toISOString();
  } else {
    delete cfg.enrichRunning;
    delete cfg.enrichStartedAt;
  }
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { config: cfg as object },
  });
}

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  let body: {
    prospectIds?: string[];
    fields?: string[];
    retryNotFound?: boolean;
    useBlitz?: boolean;
    useApollo?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { prospectIds = [], fields = [], retryNotFound = false, useBlitz = true, useApollo = true } = body;

  if (!useBlitz && !useApollo) {
    return NextResponse.json(
      { error: "At least one provider must be enabled (Blitz or Apollo)." },
      { status: 400 },
    );
  }

  if (!Array.isArray(prospectIds) || prospectIds.length === 0) {
    return NextResponse.json({ error: "prospectIds required" }, { status: 400 });
  }
  if (prospectIds.length > 200) {
    return NextResponse.json(
      { error: "Maximum 200 prospects per run. Split into multiple batches." },
      { status: 400 },
    );
  }
  const validFields = (Array.isArray(fields) ? fields : []).filter((f): f is EnrichField =>
    VALID_FIELDS.includes(f as EnrichField),
  );
  if (validFields.length === 0) {
    return NextResponse.json({ error: "fields required (one of: " + VALID_FIELDS.join(", ") + ")" }, { status: 400 });
  }

  // Verify at least one provider is configured for this workspace.
  const providers = await prisma.integration.findMany({
    where: { workspaceId: workspaceId!, provider: { in: ["BLITZ", "APOLLO"] }, isActive: true },
    select: { provider: true },
  });
  if (providers.length === 0) {
    return NextResponse.json(
      { error: "No enrichment provider configured. Add a Blitz or Apollo API key in Settings → Integrations." },
      { status: 400 },
    );
  }

  if (await isEnrichRunning(workspaceId!)) {
    return NextResponse.json({
      status: "already_running",
      message: "An enrichment job is already running for this workspace. Wait for it to finish.",
    });
  }

  await setEnrichRunning(workspaceId!, true);

  after(async () => {
    try {
      const result = await enrichProspects(workspaceId!, prospectIds, validFields, {
        retryNotFound,
        useBlitz,
        useApollo,
      });
      console.log(`[leads/enrich] Workspace ${workspaceId} done:`, result);
    } catch (e) {
      console.error(`[leads/enrich] Workspace ${workspaceId} failed:`, e instanceof Error ? e.message : e);
    } finally {
      await setEnrichRunning(workspaceId!, false);
    }
  });

  return NextResponse.json({
    status: "started",
    prospectCount: prospectIds.length,
    fields: validFields,
    providers: providers.map((p) => p.provider),
  });
}
