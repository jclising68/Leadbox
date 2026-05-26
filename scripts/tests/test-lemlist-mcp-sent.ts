// Probe: does get_inbox_conversation return sent messages with full body?
// Usage: bun scripts/tests/test-lemlist-mcp-sent.ts <integrationId>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";

async function getConversation(apiKey: string, contactId: string) {
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
  const parsed = JSON.parse(text) as { activities?: Array<Record<string, unknown>> };
  return parsed.activities ?? [];
}

async function main() {
  const integrationId = process.argv[2];
  if (!integrationId) {
    console.error("Usage: bun scripts/tests/test-lemlist-mcp-sent.ts <integrationId>");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  // Find a few recent OUTBOUND messages with their contactId
  const msgs = await prisma.message.findMany({
    where: { workspaceId: row.workspaceId, externalId: { startsWith: "act_" }, direction: "OUTBOUND" },
    select: { externalId: true, bodyText: true, rawPayload: true },
    orderBy: { receivedAt: "desc" },
    take: 3,
  });

  if (msgs.length === 0) {
    console.log("No OUTBOUND Lemlist messages found in DB");
    await prisma.$disconnect();
    return;
  }

  for (const m of msgs) {
    const raw = m.rawPayload as Record<string, unknown>;
    const contactId = raw?.contactId as string | undefined;
    console.log(`\n=== externalId: ${m.externalId} ===`);
    console.log(`  contactId: ${contactId ?? "(missing)"}`);
    console.log(`  bodyText (stored): "${(m.bodyText ?? "").slice(0, 150)}"`);
    console.log(`  rawPayload keys: ${Object.keys(raw ?? {}).join(", ")}`);
    console.log(`  messagePreview: "${(raw?.messagePreview as string ?? "").slice(0, 150)}"`);

    if (!contactId) {
      console.log("  [SKIP] No contactId — cannot call MCP");
      continue;
    }

    console.log(`  Calling MCP get_inbox_conversation for contactId=${contactId}...`);
    try {
      const activities = await getConversation(apiKey, contactId);
      console.log(`  MCP returned ${activities.length} activities`);
      for (const act of activities) {
        const msgField = act.message as string | undefined;
        console.log(`  - id=${act.id} type=${act.type} message_len=${msgField?.length ?? 0} message_preview="${(msgField ?? "").slice(0, 120)}"`);
      }
    } catch (err) {
      console.error(`  MCP error: ${err instanceof Error ? err.message : err}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
