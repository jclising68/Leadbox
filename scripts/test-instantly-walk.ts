// Walk all `desc` pages for one integration and log page-size + cursor
// to pinpoint where Instantly's API returns a short page or null cursor.
//
// Usage: DATABASE_URL=... bun run scripts/test-instantly-walk.ts <integrationId> [maxPages]

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const id = process.argv[2];
  const maxPages = parseInt(process.argv[3] ?? "200", 10);
  if (!id) {
    console.error("Usage: bun run scripts/test-instantly-walk.ts <integrationId> [maxPages]");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  let cursor: string | undefined = undefined;
  let page = 0;
  let totalItems = 0;
  let oldestTs: string | null = null;

  while (page < maxPages) {
    const u = new URL(`${BASE}/emails`);
    u.searchParams.set("limit", "100");
    u.searchParams.set("sort_order", "desc");
    if (cursor) u.searchParams.set("starting_after", cursor);

    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.log(`Page ${page + 1}: HTTP ${res.status}`);
      break;
    }
    const data = (await res.json()) as {
      items?: { id: string; timestamp_created: string }[];
      next_starting_after?: string | null;
    };
    const items = data.items ?? [];
    page++;
    totalItems += items.length;
    if (items.length > 0) oldestTs = items[items.length - 1].timestamp_created;

    const nextCursor = data.next_starting_after;
    const flags = [
      items.length < 100 ? `SHORT_PAGE(${items.length})` : "",
      !nextCursor ? "NO_CURSOR" : "",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(
      `Page ${String(page).padStart(3)}: items=${String(items.length).padStart(3)}  oldest_in_page=${items[items.length - 1]?.timestamp_created ?? "-"}  ${flags}`,
    );

    if (!nextCursor) {
      console.log(`\n== END: no next_starting_after after page ${page} ==`);
      break;
    }
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 1100));
  }

  console.log(`\nTotal: ${page} pages, ${totalItems} items, oldest=${oldestTs}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
