/**
 * One-time backfill: for all existing Instantly INBOUND messages, write
 * stepReplied / notes / campaignName back to the Prospect profile card.
 *
 * Only fills null fields — never overwrites manually-entered data.
 *
 * Usage:
 *   bun scripts/ops/backfill-instantly-prospect-data.ts
 *
 * Against prod DB:
 *   DATABASE_URL=<prod pooler url> bun scripts/ops/backfill-instantly-prospect-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching all Instantly INBOUND messages...");

  // Get every INBOUND message that came through an Instantly integration,
  // along with the prospect email from the thread.
  const messages = await prisma.message.findMany({
    where: {
      direction: "INBOUND",
      integration: { provider: "INSTANTLY" },
      thread: {
        prospect: { email: { not: null } },
      },
    },
    select: {
      campaignName: true,
      bodyText: true,
      sentAt: true,
      thread: {
        select: {
          workspaceId: true,
          prospect: {
            select: {
              email: true,
              stepReplied: true,
              notes: true,
              campaignName: true,
            },
          },
        },
      },
    },
    orderBy: { sentAt: "asc" },
  });

  console.log(`Found ${messages.length} Instantly INBOUND messages`);

  // Group by workspaceId + email, keep the latest message per prospect
  // (sentAt asc means later entries overwrite earlier — we want the most
  // recent reply for notes, same as HeyReach does).
  const prospectMap = new Map<
    string,
    { workspaceId: string; email: string; campaignName: string | null; notes: string | null }
  >();

  for (const msg of messages) {
    const email = msg.thread.prospect?.email;
    const workspaceId = msg.thread.workspaceId;
    if (!email) continue;

    const key = `${workspaceId}::${email}`;
    prospectMap.set(key, {
      workspaceId,
      email,
      campaignName: msg.campaignName ?? null,
      notes: msg.bodyText ? msg.bodyText.slice(0, 500) : null,
    });
  }

  console.log(`Updating ${prospectMap.size} unique prospects...`);

  let updated = 0;
  let skipped = 0;

  for (const { workspaceId, email, campaignName, notes } of prospectMap.values()) {
    const updateData: Record<string, string | null> = {
      stepReplied: "Step 1",
    };
    if (notes) updateData.notes = notes;
    if (campaignName) updateData.campaignName = campaignName;

    const result = await prisma.prospect.updateMany({
      where: {
        workspaceId,
        email,
        stepReplied: null,
      },
      data: updateData,
    });

    if (result.count > 0) {
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`Done. Updated: ${updated}, Skipped (already had data): ${skipped}`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
