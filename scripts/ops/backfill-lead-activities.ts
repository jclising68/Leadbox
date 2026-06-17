/**
 * One-time backfill: creates LeadActivity records from existing historical data.
 * Sources:
 *   - ThreadLabel records → label_applied
 *   - OUTBOUND Messages  → reply_sent
 *   - PipelineDeal records → pipeline_added
 *
 * Safe to run multiple times — skips workspaces that already have activity records.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = 500;

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  console.log(`Found ${workspaces.length} workspaces`);

  for (const ws of workspaces) {
    console.log(`\n── Workspace: ${ws.name} (${ws.id})`);

    const existing = await prisma.leadActivity.count({ where: { workspaceId: ws.id } });
    if (existing > 0) {
      console.log(`  ⚠ Already has ${existing} activities — skipping`);
      continue;
    }

    // ── 1. label_applied from ThreadLabel ──────────────────────────────────
    const threadLabels = await prisma.threadLabel.findMany({
      where: { thread: { workspaceId: ws.id } },
      select: {
        threadId: true,
        appliedAt: true,
        thread: { select: { prospectId: true } },
        label: { select: { name: true, color: true } },
      },
    });

    const labelRows = threadLabels.map((tl) => ({
      workspaceId: ws.id,
      threadId: tl.threadId,
      prospectId: tl.thread.prospectId ?? null,
      type: "label_applied",
      metadata: { label: tl.label.name, color: tl.label.color ?? null },
      createdAt: tl.appliedAt,
    }));

    for (let i = 0; i < labelRows.length; i += BATCH) {
      await prisma.leadActivity.createMany({ data: labelRows.slice(i, i + BATCH) });
    }
    console.log(`  ✓ label_applied: ${labelRows.length}`);

    // ── 2. reply_sent from OUTBOUND Messages ────────────────────────────────
    const outboundMsgs = await prisma.message.findMany({
      where: { workspaceId: ws.id, direction: "OUTBOUND" },
      select: {
        threadId: true,
        subject: true,
        sentAt: true,
        receivedAt: true,
        thread: { select: { prospectId: true } },
      },
    });

    const replyRows = outboundMsgs.map((m) => ({
      workspaceId: ws.id,
      threadId: m.threadId,
      prospectId: m.thread?.prospectId ?? null,
      type: "reply_sent",
      metadata: { subject: m.subject ?? "(no subject)" },
      createdAt: m.sentAt ?? m.receivedAt,
    }));

    for (let i = 0; i < replyRows.length; i += BATCH) {
      await prisma.leadActivity.createMany({ data: replyRows.slice(i, i + BATCH) });
    }
    console.log(`  ✓ reply_sent: ${replyRows.length}`);

    // ── 3. pipeline_added from PipelineDeal ─────────────────────────────────
    const deals = await prisma.pipelineDeal.findMany({
      where: { workspaceId: ws.id },
      select: {
        threadId: true,
        prospectId: true,
        createdAt: true,
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
      },
    });

    const dealRows = deals.map((d) => ({
      workspaceId: ws.id,
      threadId: d.threadId ?? null,
      prospectId: d.prospectId ?? null,
      type: "pipeline_added",
      metadata: { pipeline: d.pipeline.name, stage: d.stage.name },
      createdAt: d.createdAt,
    }));

    for (let i = 0; i < dealRows.length; i += BATCH) {
      await prisma.leadActivity.createMany({ data: dealRows.slice(i, i + BATCH) });
    }
    console.log(`  ✓ pipeline_added: ${dealRows.length}`);

    const total = labelRows.length + replyRows.length + dealRows.length;
    console.log(`  → Total created: ${total}`);
  }

  console.log("\nBackfill complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
