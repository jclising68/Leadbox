// Probe the Lemlist /activities API to see exactly what's returned for a given integration.
// Checks whether specific contacts appear and what email fields they have.
//
// Usage: bun run scripts/tests/test-lemlist-activities.ts <integrationId> [offset]

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.lemlist.com/api";
const PAGE_SIZE = 100;

const TARGET_EMAILS = [
  "ma@xpay.app",      // Mohamed / Xpay Egypt
  "ssanpedro@safirast.com", // Sonaira / SAFIRA
  "jr@gespro.com.br", // Junior / Gespro
  // Radiktya email unknown — will flag anything with "radiktya" or "xendit"
];
const TARGET_KEYWORDS = ["radiktya", "xendit", "xpay", "safira", "gespro", "mohamed", "sonaira", "junior"];

async function lemlistGet(apiKey: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lemlist ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const integrationId = process.argv[2];
  const startOffset = parseInt(process.argv[3] ?? "0", 10);

  if (!integrationId) {
    console.error("Usage: bun run scripts/tests/test-lemlist-activities.ts <integrationId> [offset]");
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
  console.log(`Integration: ${integrationId} (${row.provider}) workspace=${row.workspaceId}`);
  console.log(`Config: ${JSON.stringify(row.config)}\n`);

  // Load existing externalIds so we can see which ones are already in DB
  const existingIds = new Set(
    (await prisma.message.findMany({
      where: { workspaceId: row.workspaceId, externalId: { startsWith: "act_" } },
      select: { externalId: true },
    })).map(m => m.externalId).filter(Boolean) as string[]
  );
  console.log(`Existing act_ IDs in DB: ${existingIds.size}\n`);

  for (const type of ["emailsReplied", "emailsSent"] as const) {
    console.log(`\n===== type=${type} =====`);
    let offset = startOffset;
    let totalPages = 0;
    let totalFound = 0;
    let hits: unknown[] = [];

    while (true) {
      const page = await lemlistGet(apiKey, "/activities", {
        type,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      }) as Array<Record<string, unknown>>;

      if (!Array.isArray(page)) {
        console.log(`Non-array response at offset ${offset}:`, page);
        break;
      }

      totalPages++;
      totalFound += page.length;

      for (const act of page) {
        const id = act._id as string;
        const leadEmail = (act.leadEmail || act.email || act.fromEmail || "") as string;
        const rawStr = JSON.stringify(act).toLowerCase();

        const isTarget =
          TARGET_EMAILS.some(e => leadEmail?.toLowerCase() === e) ||
          TARGET_KEYWORDS.some(kw => rawStr.includes(kw));

        if (isTarget) {
          hits.push({
            _id: id,
            type: act.type,
            createdAt: act.createdAt,
            leadEmail: act.leadEmail,
            email: act.email,
            fromEmail: act.fromEmail,
            sendUserEmail: act.sendUserEmail,
            leadFirstName: act.leadFirstName,
            leadLastName: act.leadLastName,
            leadCompanyName: act.leadCompanyName,
            campaignId: act.campaignId,
            campaignName: act.name,
            contactId: act.contactId,
            inDB: existingIds.has(id),
          });
        }

        // Also flag activities with NO email fields at all
        if (!act.leadEmail && !act.email && !act.fromEmail) {
          if (type === "emailsReplied") {
            console.log(`  [NO EMAIL] offset=${offset} _id=${id} type=${act.type} createdAt=${act.createdAt}`);
          }
        }
      }

      console.log(`  offset=${offset}: ${page.length} activities (${hits.length} target hits so far)`);

      if (page.length < PAGE_SIZE) {
        console.log(`  End of ${type} at offset ${offset + page.length}`);
        break;
      }

      offset += PAGE_SIZE;
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n${type} summary: ${totalFound} total activities across ${totalPages} pages`);
    if (hits.length > 0) {
      console.log(`\nTARGET HITS for ${type}:`);
      for (const h of hits) {
        console.log(JSON.stringify(h, null, 2));
      }
    } else {
      console.log(`No target contacts found in ${type}`);
    }
    hits = [];
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
