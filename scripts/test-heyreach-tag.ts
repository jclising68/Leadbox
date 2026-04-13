/**
 * Standalone test for HeyReach tag push. Bypasses Next.js entirely so we can
 * isolate whether the failure is in our code or in the dev server's stale
 * compiled bundle.
 *
 * Usage:
 *   bun scripts/test-heyreach-tag.ts <prospect-email-or-linkedin-url> [tag1] [tag2]...
 *
 * Example:
 *   bun scripts/test-heyreach-tag.ts jrhodes@housingpanda.com Interested
 */
import { syncProviderTags } from "@/services/provider-tags";
import { prisma } from "@/lib/prisma";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: bun scripts/test-heyreach-tag.ts <prospect-email-or-linkedin-url>");
    process.exit(1);
  }

  const prospect = await prisma.prospect.findFirst({
    where: arg.includes("@")
      ? { email: arg }
      : { linkedinUrl: { contains: arg } },
    include: { thread: true },
  });

  if (!prospect) {
    console.error(`No prospect found matching "${arg}"`);
    process.exit(1);
  }
  if (!prospect.thread) {
    console.error(`Prospect ${prospect.id} has no thread`);
    process.exit(1);
  }

  console.log("──────────── Prospect ────────────");
  console.log("  id:           ", prospect.id);
  console.log("  email:        ", prospect.email);
  console.log("  linkedinUrl:  ", prospect.linkedinUrl);
  console.log("  workspaceId:  ", prospect.workspaceId);
  console.log("  thread.id:    ", prospect.thread.id);
  console.log("  thread.channel:", prospect.thread.channel);
  console.log("──────────────────────────────────");

  const result = await syncProviderTags(prospect.workspaceId, prospect.thread.id);
  console.log("\nResult:", JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
