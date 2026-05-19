// One-off: re-strip bodyText for Lemlist messages whose bodyHtml contains <style> block CSS
// Usage: bun scripts/ops/fix-lemlist-body-text.ts [--dry-run]

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Only fix Lemlist messages (externalId starts with "act_") that have
  // VML CSS garbage in bodyText — the telltale string is "behavior:url"
  const messages = await prisma.message.findMany({
    where: {
      externalId: { startsWith: "act_" },
      bodyHtml: { not: null },
      bodyText: { contains: "behavior:url" },
    },
    select: { id: true, bodyHtml: true, bodyText: true, externalId: true },
  });

  console.log(`Found ${messages.length} messages with bodyHtml`);

  let fixed = 0;
  let skipped = 0;

  for (const msg of messages) {
    const cleanText = stripHtml(msg.bodyHtml!);
    if (cleanText === msg.bodyText) {
      skipped++;
      continue;
    }

    console.log(`[${msg.id}] externalId=${msg.externalId}`);
    console.log(`  OLD: ${(msg.bodyText ?? "").slice(0, 120)}`);
    console.log(`  NEW: ${cleanText.slice(0, 120)}`);

    if (!dryRun) {
      await prisma.message.update({
        where: { id: msg.id },
        data: { bodyText: cleanText },
      });
    }
    fixed++;
  }

  console.log(`\n${dryRun ? "[DRY RUN] Would fix" : "Fixed"} ${fixed} messages, ${skipped} already clean`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
