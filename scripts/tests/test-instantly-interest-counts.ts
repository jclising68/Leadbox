// Sweep /leads/list (up to N pages) and count how many leads per
// lt_interest_status value. Shows which codes are actually populated.
//
// Usage: bun run scripts/test-instantly-interest-counts.ts <integrationId> [maxPages]

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const id = process.argv[2];
  const maxPages = parseInt(process.argv[3] ?? "5", 10);
  if (!id) {
    console.error("Usage: bun run scripts/test-instantly-interest-counts.ts <integrationId> [maxPages]");
    process.exit(1);
  }
  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  const counts = new Map<string, number>();
  let cursor: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const res = await fetch(`${BASE}/leads/list`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }),
    });
    const data = (await res.json()) as {
      items?: { lt_interest_status?: number | null; email_reply_count?: number }[];
      next_starting_after?: string | null;
    };
    const items = data.items ?? [];
    page++;
    for (const l of items) {
      const key = `lt=${l.lt_interest_status ?? "null"} reply=${(l.email_reply_count ?? 0) > 0 ? "y" : "n"}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (!data.next_starting_after) break;
    cursor = data.next_starting_after;
    await new Promise((r) => setTimeout(r, 1100));
  }

  console.log(`\nScanned ${page} page(s):\n`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`  ${k.padEnd(22)}  ${v}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
