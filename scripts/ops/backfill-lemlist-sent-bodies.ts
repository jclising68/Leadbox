// Backfill full HTML bodies for existing OUTBOUND Lemlist messages.
// Previously these were stored using activity.messagePreview (~100 chars).
// This script calls the Lemlist MCP per contactId and updates bodyText + bodyHtml.
//
// Usage: bun scripts/ops/backfill-lemlist-sent-bodies.ts [--dry-run] [integrationId]
//   --dry-run  print what would be updated without writing
//   integrationId  optional; if omitted, runs for all LEMLIST integrations

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";
const BATCH_PAUSE_MS = 250;

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getConversation(
  apiKey: string,
  contactId: string
): Promise<Array<{ id: string; type: string; message?: string }>> {
  const res = await fetch(LEMLIST_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_inbox_conversation", arguments: { contactId, limit: 50 } },
    }),
  });
  if (!res.ok) throw new Error(`MCP ${res.status}: ${await res.text()}`);
  const data = await res.json() as { result?: { content?: Array<{ type: string; text: string }> } };
  const text = data.result?.content?.find((c) => c.type === "text")?.text;
  if (!text) return [];
  const parsed = JSON.parse(text) as { activities?: Array<{ id: string; type: string; message?: string }> };
  return parsed.activities ?? [];
}

async function backfillIntegration(integrationId: string, dryRun: boolean) {
  const row = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
  console.log(`\n[backfill] Integration ${integrationId} workspace=${row.workspaceId}`);

  // Only OUTBOUND Lemlist messages — bodyHtml is null means they were stored from messagePreview
  const messages = await prisma.message.findMany({
    where: {
      workspaceId: row.workspaceId,
      externalId: { startsWith: "act_" },
      direction: "OUTBOUND",
      bodyHtml: null,
    },
    select: { id: true, externalId: true, rawPayload: true },
  });

  console.log(`[backfill] ${messages.length} OUTBOUND messages with no bodyHtml to backfill`);
  if (messages.length === 0) return { updated: 0, skipped: 0 };

  // Group by contactId
  const byContact = new Map<string, Array<{ id: string; externalId: string }>>();
  for (const m of messages) {
    const raw = m.rawPayload as Record<string, unknown>;
    const contactId = raw?.contactId as string | undefined;
    if (!contactId) continue;
    if (!byContact.has(contactId)) byContact.set(contactId, []);
    byContact.get(contactId)!.push({ id: m.id, externalId: m.externalId! });
  }

  console.log(`[backfill] ${byContact.size} unique contactIds to fetch`);

  // activityId → full HTML body
  const bodyMap = new Map<string, string>();

  let contactsFetched = 0;
  for (const [contactId] of byContact) {
    try {
      const activities = await getConversation(apiKey, contactId);
      for (const act of activities) {
        if (act.message) bodyMap.set(act.id, act.message);
      }
      contactsFetched++;
      if (contactsFetched % 10 === 0) {
        console.log(`[backfill] Fetched ${contactsFetched}/${byContact.size} contacts...`);
      }
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    } catch (err) {
      console.error(`[backfill] Failed to fetch contactId=${contactId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[backfill] bodyMap has ${bodyMap.size} activity bodies`);

  let updated = 0;
  let skipped = 0;

  for (const m of messages) {
    const html = bodyMap.get(m.externalId!);
    if (!html) {
      skipped++;
      continue;
    }

    const bodyText = stripHtml(html);

    if (dryRun) {
      console.log(`[dry-run] Would update ${m.externalId}: bodyText="${bodyText.slice(0, 80)}..." bodyHtml_len=${html.length}`);
      updated++;
      continue;
    }

    await prisma.message.update({
      where: { id: m.id },
      data: { bodyText, bodyHtml: html },
    });
    updated++;
  }

  console.log(`[backfill] Done: ${updated} updated, ${skipped} skipped (no MCP body found)`);
  return { updated, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const explicitId = args.find((a) => !a.startsWith("--"));

  console.log(`[backfill] mode=${dryRun ? "DRY RUN" : "LIVE"}`);

  let integrationIds: string[];
  if (explicitId) {
    integrationIds = [explicitId];
  } else {
    const rows = await prisma.integration.findMany({
      where: { provider: "LEMLIST" },
      select: { id: true },
    });
    integrationIds = rows.map((r) => r.id);
  }

  console.log(`[backfill] Running for ${integrationIds.length} integration(s): ${integrationIds.join(", ")}`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const id of integrationIds) {
    const { updated, skipped } = await backfillIntegration(id, dryRun);
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  console.log(`\n[backfill] Total: ${totalUpdated} updated, ${totalSkipped} skipped`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
