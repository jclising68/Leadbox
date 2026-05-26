/**
 * One-off script: adds the "Follow Up" system label to all existing workspaces
 * that don't already have it. Run once after deploying the feature.
 *
 * Usage: bunx tsx scripts/ops/backfill-follow-up-label.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  console.log(`Found ${workspaces.length} workspace(s)`);

  let added = 0;
  let skipped = 0;

  for (const ws of workspaces) {
    const existing = await prisma.label.findFirst({
      where: { workspaceId: ws.id, name: "Follow Up" },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.label.create({
      data: {
        workspaceId: ws.id,
        name: "Follow Up",
        color: "#F59E0B",
        isSystem: true,
        sortOrder: 9,
      },
    });
    added++;
    console.log(`  + Added "Follow Up" to workspace: ${ws.name} (${ws.id})`);
  }

  console.log(`\nDone — added: ${added}, skipped (already exists): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
