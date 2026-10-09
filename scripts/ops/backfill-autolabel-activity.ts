/**
 * Targeted backfill: creates label_applied LeadActivity records for auto-labels
 * (source = AUTO_AI or WEBHOOK) applied between the activity feature launch
 * (Jun 17 2026) and the fix that wired applyAutoLabel() to logActivity (Jun 19 2026).
 *
 * Idempotent: skips any thread+label combo already covered by an existing
 * label_applied activity row.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = 500;
const DRY_RUN = process.argv.includes("--dry-run");
const GAP_START = new Date("2026-06-17T00:00:00.000Z");

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  console.log(`Found ${workspaces.length} workspaces${DRY_RUN ? " (DRY RUN - no writes)" : ""}`);

  let grandTotal = 0;

  for (const ws of workspaces) {
    console.log(`\n── Workspace: ${ws.name} (${ws.id})`);

    // All auto-applied labels since the feature launch
    const autoLabels = await prisma.threadLabel.findMany({
      where: {
        thread: { workspaceId: ws.id },
        source: { in: ["AUTO_AI", "WEBHOOK"] },
        appliedAt: { gte: GAP_START },
      },
      select: {
        threadId: true,
        appliedAt: true,
        thread: { select: { prospectId: true } },
        label: { select: { name: true } },
      },
    });

    if (autoLabels.length === 0) {
      console.log(`  No auto-labels in gap window`);
      continue;
    }

    // Existing label_applied activities since the feature launch — build a
    // Set of "threadId:labelName" combos already covered so we don't double-insert
    const existing = await prisma.leadActivity.findMany({
      where: {
        workspaceId: ws.id,
        type: "label_applied",
        createdAt: { gte: GAP_START },
      },
      select: { threadId: true, metadata: true },
    });

    const covered = new Set(
      existing
        .filter((a) => a.threadId)
        .map((a) => {
          const meta = a.metadata as Record<string, string | null> | null;
          return `${a.threadId}:${meta?.label ?? ""}`;
        })
    );

    const rows = autoLabels
      .filter((tl) => !covered.has(`${tl.threadId}:${tl.label.name}`))
      .map((tl) => ({
        workspaceId: ws.id,
        threadId: tl.threadId,
        prospectId: tl.thread?.prospectId ?? null,
        type: "label_applied",
        metadata: { label: tl.label.name },
        createdAt: tl.appliedAt,
      }));

    if (DRY_RUN) {
      for (const r of rows) {
        console.log(`  [dry-run] would insert label_applied thread=${r.threadId} label=${r.metadata.label} createdAt=${r.createdAt.toISOString()}`);
      }
    } else {
      for (let i = 0; i < rows.length; i += BATCH) {
        await prisma.leadActivity.createMany({ data: rows.slice(i, i + BATCH) });
      }
    }

    console.log(`  ✓ label_applied (auto) ${DRY_RUN ? "would insert" : "inserted"}: ${rows.length}  (${autoLabels.length - rows.length} already covered)`);
    grandTotal += rows.length;
  }

  console.log(`\nBackfill complete. Total ${DRY_RUN ? "that would be inserted" : "inserted"}: ${grandTotal}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
