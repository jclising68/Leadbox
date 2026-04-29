// Fetch emails for one lead and dump every field so we can see where
// Instantly stores AI classification tags like "Out of office".
//
// Usage: bun run scripts/test-instantly-email.ts <integrationId> <lead_email>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const id = process.argv[2];
  const email = process.argv[3];
  if (!id || !email) {
    console.error("Usage: bun run scripts/test-instantly-email.ts <integrationId> <email>");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  const u = new URL(`${BASE}/emails`);
  u.searchParams.set("limit", "5");
  u.searchParams.set("lead", email);
  u.searchParams.set("mode", "emode_all");
  u.searchParams.set("preview_only", "true");

  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = (await res.json()) as { items?: Record<string, unknown>[] };
  const items = data.items ?? [];
  console.log(`\nFound ${items.length} email(s) for "${email}":\n`);
  for (const em of items) {
    // Print all keys + values, stripping body
    const clean = { ...em };
    delete clean.body;
    delete clean.body_html;
    delete clean.body_text;
    console.log(JSON.stringify(clean, null, 2));
    console.log("-".repeat(60));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
