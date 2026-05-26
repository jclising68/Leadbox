// Fix João de Jesus in production:
// 1. Set campaignName so thread routes to Inbox (not Outbound Inbox)
// 2. Fix VML-corrupted bodyText for all affected Lemlist messages
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL } },
});

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

  // 1. Set campaignName on João de Jesus's prospect (ws_iomete)
  const prospect = await prisma.prospect.findFirst({
    where: { workspaceId: "ws_iomete", email: "joao.jesus@millenniumbcp.pt" },
    select: { id: true, email: true, campaignName: true },
  });

  if (!prospect) {
    console.error("Prospect not found!");
  } else {
    console.log(`Prospect: ${prospect.email}, current campaignName: ${prospect.campaignName}`);
    if (!dryRun) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { campaignName: "Tier 2 Campaign" },
      });
      console.log("  → Set campaignName = 'Tier 2 Campaign'");
    } else {
      console.log("  [DRY RUN] Would set campaignName = 'Tier 2 Campaign'");
    }
  }

  // 2. Fix VML-corrupted bodyText for all affected Lemlist messages in prod
  const vmlMessages = await prisma.message.findMany({
    where: {
      externalId: { startsWith: "act_" },
      bodyText: { contains: "behavior:url" },
      bodyHtml: { not: null },
    },
    select: { id: true, externalId: true, bodyHtml: true, bodyText: true },
  });

  console.log(`\nVML-affected messages: ${vmlMessages.length}`);
  for (const msg of vmlMessages) {
    const cleanText = stripHtml(msg.bodyHtml!);
    console.log(`  ${msg.externalId}`);
    console.log(`  OLD: ${(msg.bodyText ?? "").slice(0, 80)}`);
    console.log(`  NEW: ${cleanText.slice(0, 80)}`);
    if (!dryRun) {
      await prisma.message.update({ where: { id: msg.id }, data: { bodyText: cleanText } });
      console.log("  → Fixed");
    } else {
      console.log("  [DRY RUN]");
    }
  }

  console.log(`\n${dryRun ? "DRY RUN complete" : "Done"}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
