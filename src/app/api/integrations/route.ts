import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";
import { encrypt, maskApiKey, decrypt } from "@/lib/crypto";
import { v4 as uuid } from "uuid";
import { syncInstantly, testInstantlyConnection } from "@/services/instantly-sync";
import { syncHeyreach, testHeyreachConnection } from "@/services/heyreach-sync";
import { enrichFromInstantly } from "@/services/lead-enrichment";
import { STALE_LOCK_MS, type SyncProgress } from "@/services/sync-progress";

// Initial sync + enrichment can take a while for large accounts
export const maxDuration = 300;

function getAppUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin ||
    "https://leadbox-phi.vercel.app"
  );
}

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const appUrl = getAppUrl(req);

  const integrations = await prisma.integration.findMany({
    where: { workspaceId: workspaceId! },
    orderBy: { createdAt: "desc" },
  });

  // Get message stats per integration (total + last-30-days to surface
  // whether sync is actually pulling in fresh data).
  const integrationIds = integrations.map((i) => i.id);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalStats, recentStats] = await Promise.all([
    prisma.message.groupBy({
      by: ["integrationId"],
      where: { integrationId: { in: integrationIds } },
      _count: true,
      _max: { sentAt: true },
    }),
    prisma.message.groupBy({
      by: ["integrationId"],
      where: {
        integrationId: { in: integrationIds },
        sentAt: { gte: thirtyDaysAgo },
      },
      _count: true,
    }),
  ]);

  const totalMap = new Map(
    totalStats.map((s) => [s.integrationId, { totalMessages: s._count, lastActivityAt: s._max.sentAt }])
  );
  const recentMap = new Map(
    recentStats.map((s) => [s.integrationId, s._count])
  );

  const now = Date.now();

  const masked = integrations.map((i) => {
    const iStats = totalMap.get(i.id);
    const config = (i.config as Record<string, unknown>) ?? {};
    const syncStartedAt = config.syncStartedAt as string | undefined;
    const syncStuck =
      !!config.syncRunning &&
      !!syncStartedAt &&
      now - new Date(syncStartedAt).getTime() > STALE_LOCK_MS;

    return {
      ...i,
      apiKeyEncrypted: undefined,
      apiKeyIv: undefined,
      apiKeyTag: undefined,
      config: undefined,
      apiKeyMasked: maskApiKey(
        decrypt(i.apiKeyEncrypted, i.apiKeyIv, i.apiKeyTag)
      ),
      webhookUrl: `${appUrl}/api/webhooks/${i.provider.toLowerCase()}?workspace_id=${workspaceId}&secret=${i.webhookSecret}`,
      totalMessages: iStats?.totalMessages ?? 0,
      messagesLast30Days: recentMap.get(i.id) ?? 0,
      lastActivityAt: iStats?.lastActivityAt ?? null,
      syncing: !!config.syncRunning,
      syncStartedAt: syncStartedAt ?? null,
      syncStuck,
      syncProgress: (config.syncProgress as SyncProgress | undefined) ?? null,
      enriching: !!config.enrichRunning,
      lastError: (config.lastError as string | undefined) ?? null,
      lastErrorAt: (config.lastErrorAt as string | undefined) ?? null,
    };
  });

  return workspaceJson(masked);
}

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const appUrl = getAppUrl(req);

  const { provider, name, apiKey } = await req.json();

  if (!provider || !name || !apiKey) {
    return NextResponse.json(
      { error: "provider, name, and apiKey are required" },
      { status: 400 }
    );
  }

  if (!["INSTANTLY", "HEYREACH"].includes(provider)) {
    return NextResponse.json(
      { error: "Invalid provider" },
      { status: 400 }
    );
  }

  // Test connection before saving
  try {
    const isValid = provider === "INSTANTLY"
      ? await testInstantlyConnection(apiKey)
      : await testHeyreachConnection(apiKey);

    if (!isValid) {
      return NextResponse.json(
        { error: `Failed to connect to ${provider}. Please verify your API key is correct and has the necessary permissions.` },
        { status: 400 }
      );
    }
  } catch (err) {
    console.error(`[integration] Connection test error for ${provider}:`, err);
    return NextResponse.json(
      { error: `Connection test failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 400 }
    );
  }

  const { encrypted, iv, tag } = encrypt(apiKey);
  const webhookSecret = uuid();

  const integration = await prisma.integration.create({
    data: {
      workspaceId: workspaceId!,
      provider,
      name,
      apiKeyEncrypted: encrypted,
      apiKeyIv: iv,
      apiKeyTag: tag,
      webhookSecret,
    },
  });

  // Trigger historical sync + enrichment in background (serverless-safe)
  after(async () => {
    const syncFn = provider === "INSTANTLY" ? syncInstantly : syncHeyreach;
    try {
      const result = await syncFn(integration.id);
      console.log(`[sync] Initial sync done for ${integration.id}: ${result.synced} synced`);
      if (provider === "INSTANTLY") {
        try {
          const enrichResult = await enrichFromInstantly(integration.id);
          console.log(`[sync] Auto-enrichment done: ${enrichResult.enriched} enriched, ${enrichResult.imported} imported`);
        } catch (err) {
          console.error(`[sync] Auto-enrichment failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[sync] Background sync failed for ${integration.id}:`, err);
    }
  });

  return NextResponse.json(
    {
      id: integration.id,
      provider: integration.provider,
      name: integration.name,
      isActive: integration.isActive,
      syncing: true,
      webhookUrl: `${appUrl}/api/webhooks/${provider.toLowerCase()}?workspace_id=${workspaceId}&secret=${webhookSecret}`,
      createdAt: integration.createdAt,
    },
    { status: 201 }
  );
}
