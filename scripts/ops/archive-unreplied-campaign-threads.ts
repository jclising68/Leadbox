/**
 * One-off backfill: archive all OPEN campaign threads that have no inbound reply.
 *
 * Safe to run multiple times (idempotent). Does NOT touch:
 *   - threads that already have an INBOUND message (those belong in Inbox)
 *   - threads with no campaign integration messages (those belong in Outbound Inbox)
 *   - threads already ARCHIVED, SPAM, or TRASH
 *
 * Run: bun scripts/ops/archive-unreplied-campaign-threads.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const campaignProviders: ("INSTANTLY" | "HEYREACH" | "LEMLIST")[] = ["INSTANTLY", "HEYREACH", "LEMLIST"];

  // Find all OPEN threads that:
  //   1. Have at least one message from a campaign integration
  //   2. Have NO inbound replies
  const toArchive = await prisma.thread.findMany({
    where: {
      status: "OPEN",
      messages: {
        some: { integration: { provider: { in: campaignProviders } } },
        none: { direction: "INBOUND" },
      },
    },
    select: { id: true },
  });

  if (toArchive.length === 0) {
    console.log("Nothing to archive — all campaign threads are already correctly placed.");
    return;
  }

  console.log(`Archiving ${toArchive.length} unreplied campaign thread(s)...`);

  const ids = toArchive.map((t) => t.id);
  const result = await prisma.thread.updateMany({
    where: { id: { in: ids } },
    data: { status: "ARCHIVED" },
  });

  console.log(`Done. Archived ${result.count} thread(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
