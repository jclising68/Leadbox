// Probe HeyReach for the right GetTagsForLead path + body shape.
//
// Usage: bun run scripts/test-heyreach-tags-path.ts <integrationId> <profileUrl>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.heyreach.io/api/public";

async function probe(apiKey: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`  POST ${path}  body=${JSON.stringify(body)}  status=${res.status}  body_preview=${text.slice(0, 120)}`);
}

async function main() {
  const id = process.argv[2];
  const profileUrl = process.argv[3];
  if (!id || !profileUrl) {
    console.error("Usage: bun run scripts/test-heyreach-tags-path.ts <integrationId> <profileUrl>");
    process.exit(1);
  }
  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  console.log(`Probing tag endpoints with profileUrl=${profileUrl}\n`);

  for (const p of ["/lead/GetTagsForLead", "/lead/GetTags", "/Lead/GetTagsForLead"]) {
    for (const body of [{ leadProfileUrl: profileUrl }, { profileUrl }]) {
      await probe(apiKey, p, body);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
