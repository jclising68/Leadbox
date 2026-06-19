/**
 * One-time backfill: creates reply_received LeadActivity records from existing
 * INBOUND messages that have real body content.
 *
 * Idempotent: skips threads that already have a reply_received activity row.
 * Safe to run multiple times.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = 500;

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  console.log(`Found ${workspaces.length} workspaces`);

  let grandTotal = 0;

  for (const ws of workspaces) {
    console.log(`\n── Workspace: ${ws.name} (${ws.id})`);

    // Get thread IDs that already have a reply_received activity (for idempotency)
    const existing = await prisma.leadActivity.findMany({
      where: { workspaceId: ws.id, type: "reply_received" },
      select: { threadId: true },
    });
    const alreadyDone = new Set(existing.map((a) => a.threadId).filter(Boolean));
    console.log(`  Already has ${alreadyDone.size} threads with reply_received`);

    // All INBOUND messages with real content
    const inboundMsgs = await prisma.message.findMany({
      where: {
        workspaceId: ws.id,
        direction: "INBOUND",
        OR: [
          { bodyText: { not: null } },
          { messageText: { not: null } },
        ],
      },
      select: {
        threadId: true,
        bodyText: true,
        messageText: true,
        sentAt: true,
        receivedAt: true,
        channel: true,
        thread: { select: { prospectId: true, channel: true } },
      },
      orderBy: { sentAt: "asc" },
    });

    // Filter: only messages with actual non-empty content, not already covered
    const rows = inboundMsgs
      .filter((m) => {
        const hasContent = !!(m.bodyText?.trim() || m.messageText?.trim());
        return hasContent && !alreadyDone.has(m.threadId);
      })
      .map((m) => ({
        workspaceId: ws.id,
        threadId: m.threadId,
        prospectId: m.thread?.prospectId ?? null,
        type: "reply_received",
        metadata: { channel: m.thread?.channel ?? m.channel ?? "EMAIL" },
        createdAt: m.sentAt ?? m.receivedAt ?? new Date(),
      }));

    // Dedupe: keep only the first reply_received per thread (earliest message)
    const seen = new Set<string>();
    const deduped = rows.filter((r) => {
      if (seen.has(r.threadId)) return false;
      seen.add(r.threadId);
      return true;
    });

    for (let i = 0; i < deduped.length; i += BATCH) {
      await prisma.leadActivity.createMany({ data: deduped.slice(i, i + BATCH) });
    }

    console.log(`  ✓ reply_received inserted: ${deduped.length}`);
    grandTotal += deduped.length;
  }

  console.log(`\nBackfill complete. Total inserted: ${grandTotal}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
