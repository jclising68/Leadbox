// Prints integrationIds and sample threadIds you can use for the attachment probe scripts.
// Usage: bun run scripts/tests/get-test-ids.ts <workspaceId>
// workspaceId is in the URL: /ws/<workspaceId>/inbox

import { prisma } from "@/lib/prisma";

async function main() {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    // List all workspaces so user can pick
    const workspaces = await prisma.workspace.findMany({
      select: { id: true, name: true, slug: true },
    });
    console.log("\nAvailable workspaces:");
    for (const w of workspaces) {
      console.log(`  slug: ${w.slug}  id: ${w.id}  name: ${w.name}`);
    }
    console.log(
      "\nRun again with: bun run scripts/tests/get-test-ids.ts <workspaceId>"
    );
    return;
  }

  const integrations = await prisma.integration.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, provider: true, name: true },
  });

  console.log("\n=== INTEGRATIONS ===");
  for (const i of integrations) {
    console.log(`  ${i.provider.padEnd(10)} id: ${i.id}  name: ${i.name}`);
  }

  const providers = ["INSTANTLY", "LEMLIST", "HEYREACH"] as const;
  for (const provider of providers) {
    const integration = integrations.find((i) => i.provider === provider);
    if (!integration) {
      console.log(`\n=== ${provider} — no active integration found ===`);
      continue;
    }

    // Get a recent thread that has messages from this integration
    const threads = await prisma.thread.findMany({
      where: {
        workspaceId,
        messages: {
          some: { integrationId: integration.id },
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 3,
      select: {
        id: true,
        channel: true,
        prospect: { select: { email: true, firstName: true, lastName: true } },
        messages: {
          where: { integrationId: integration.id },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            externalId: true,
            fromEmail: true,
            toEmail: true,
            direction: true,
          },
        },
      },
    });

    console.log(`\n=== ${provider} ===`);
    console.log(`  integrationId: ${integration.id}`);
    console.log(`  Recent threads:`);
    for (const t of threads) {
      const msg = t.messages[0];
      const prospect = `${t.prospect?.firstName ?? ""} ${t.prospect?.lastName ?? ""}`.trim() || t.prospect?.email;
      console.log(`    threadId: ${t.id}  channel: ${t.channel}  prospect: ${prospect}`);
      if (msg) {
        console.log(
          `      last msg → direction: ${msg.direction}  from: ${msg.fromEmail}  externalId: ${msg.externalId}`
        );
        if (provider === "INSTANTLY" && msg.externalId) {
          console.log(`      replyToUuid (for Instantly test): ${msg.externalId}`);
          console.log(`      eaccount: ${msg.direction === "OUTBOUND" ? msg.fromEmail : msg.toEmail}`);
        }
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
