// List workspace-level custom tags in Instantly to see if "Out of office"
// is a managed tag and how it's referenced on leads/emails.
//
// Usage: bun run scripts/test-instantly-tags.ts <integrationId>

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: bun run scripts/test-instantly-tags.ts <integrationId>");
    process.exit(1);
  }
  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  console.log("== /custom-tags ==");
  const tagsRes = await fetch(`${BASE}/custom-tags?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log(JSON.stringify(await tagsRes.json(), null, 2));

  await new Promise((r) => setTimeout(r, 1100));
  console.log("\n== /emails?i_status != 0 (first 5 focused) ==");
  const emRes = await fetch(`${BASE}/emails?limit=5&sort_order=desc&mode=emode_all`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const emData = (await emRes.json()) as { items?: Record<string, unknown>[] };
  for (const em of emData.items ?? []) {
    console.log(JSON.stringify({
      subject: em.subject,
      from: em.from_address_email,
      ue_type: em.ue_type,
      i_status: em.i_status,
      ai_interest_value: em.ai_interest_value,
      is_focused: em.is_focused,
    }, null, 2));
  }

  await new Promise((r) => setTimeout(r, 1100));
  console.log("\n== /leads/list — check for custom_tag_ids + pause_until distribution ==");
  const ldRes = await fetch(`${BASE}/leads/list`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 10 }),
  });
  const ldData = (await ldRes.json()) as { items?: Record<string, unknown>[] };
  for (const l of ldData.items ?? []) {
    console.log(JSON.stringify({
      email: l.email,
      lt_interest_status: l.lt_interest_status,
      pause_until: l.pause_until ?? (l.payload as Record<string, unknown>)?.pause_until ?? null,
      custom_tag_ids: l.custom_tag_ids,
      status: l.status,
      email_reply_count: l.email_reply_count,
    }, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
