// One-off diagnostic: fetch oldest page via each `mode` for Stable Sea
// and print item counts + oldest timestamp to verify emode_all returns
// strictly more than emode_focused.
//
// Usage: bun run scripts/test-instantly-modes.ts <integrationId>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function probe(apiKey: string, mode: string | undefined) {
  const u = new URL(`${BASE}/emails`);
  u.searchParams.set("limit", "100");
  u.searchParams.set("sort_order", "asc"); // Oldest first
  if (mode) u.searchParams.set("mode", mode);

  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = (await res.json()) as { items?: { timestamp_created: string }[] };
  const items = data.items ?? [];
  return {
    mode: mode ?? "(default)",
    count: items.length,
    oldest: items[0]?.timestamp_created ?? null,
  };
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: bun run scripts/test-instantly-modes.ts <integrationId>");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  console.log(`Probing Instantly /emails with different modes for integration ${id}`);
  for (const mode of [undefined, "emode_focused", "emode_others", "emode_all"]) {
    const r = await probe(apiKey, mode);
    console.log(`  mode=${r.mode.padEnd(16)}  items=${String(r.count).padStart(3)}  oldest=${r.oldest ?? "-"}`);
    await new Promise((r) => setTimeout(r, 1100)); // Pace 1 req/sec
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
