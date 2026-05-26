// Check raw Lemlist activity payloads to find why campaignName is null in production
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL } },
});

async function main() {
  // Get rawPayload from a few OUTBOUND Lemlist messages to see if campaignId/name is present
  const outbound = await prisma.message.findMany({
    where: { externalId: { startsWith: "act_" }, direction: "OUTBOUND" },
    select: { externalId: true, rawPayload: true },
    take: 3,
    orderBy: { receivedAt: "desc" },
  });

  console.log("=== Raw payload from 3 recent OUTBOUND Lemlist messages ===");
  for (const m of outbound) {
    const raw = m.rawPayload as Record<string, unknown> | null;
    console.log(`\nexternalId: ${m.externalId}`);
    console.log(`  campaignId: ${raw?.campaignId ?? "(missing)"}`);
    console.log(`  name: ${raw?.name ?? "(missing)"}`);
    console.log(`  type: ${raw?.type ?? "(missing)"}`);
    console.log(`  leadEmail: ${raw?.leadEmail ?? raw?.email ?? "(missing)"}`);
    console.log(`  keys: ${Object.keys(raw ?? {}).join(", ")}`);
  }

  // Get rawPayload from João de Jesus (INBOUND)
  const joao = await prisma.message.findFirst({
    where: { externalId: "act_XccDJBrxcB3t9hPbW" },
    select: { rawPayload: true },
  });
  const raw = joao?.rawPayload as Record<string, unknown> | null;
  console.log("\n=== João de Jesus raw payload ===");
  console.log(`  campaignId: ${raw?.campaignId ?? "(missing)"}`);
  console.log(`  name: ${raw?.name ?? "(missing)"}`);
  console.log(`  keys: ${Object.keys(raw ?? {}).join(", ")}`);

  // Check how many OUTBOUND prospects in IOMETE workspace have campaignName set
  const total = await prisma.prospect.count({ where: { workspaceId: "ws_iomete" } });
  const withCampaign = await prisma.prospect.count({
    where: { workspaceId: "ws_iomete", campaignName: { not: null } },
  });
  console.log(`\n=== IOMETE prospects: ${withCampaign}/${total} have campaignName ===`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
