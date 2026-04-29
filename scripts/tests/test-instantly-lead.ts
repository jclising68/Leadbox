// Look up a specific lead in Instantly's /leads/list API to see
// what fields carry the auto-classification ("Out of office" etc).
//
// Usage: bun run scripts/test-instantly-lead.ts <integrationId> <email>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const id = process.argv[2];
  const email = process.argv[3];
  if (!id || !email) {
    console.error("Usage: bun run scripts/test-instantly-lead.ts <integrationId> <email>");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  // /leads/list with a search filter
  const res = await fetch(`${BASE}/leads/list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search: email, limit: 5 }),
  });

  const data = (await res.json()) as { items?: Record<string, unknown>[] };
  const items = data.items ?? [];
  console.log(`\nFound ${items.length} lead(s) for "${email}":\n`);
  for (const lead of items) {
    console.log(JSON.stringify(lead, null, 2));
    console.log("-".repeat(60));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
