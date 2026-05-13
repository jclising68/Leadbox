// Probe whether HeyReach's /Inbox/SendMessage accepts image/media fields.
// Also checks the actual API docs endpoint for any undocumented fields.
//
// Usage: bun run scripts/tests/test-heyreach-send-image.ts <integrationId> <threadId>
//
// threadId: a LeadBox thread ID with HeyReach messages (has conversationId in rawPayload)
//
// WARNING: This sends real LinkedIn messages. Use a test conversation.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.heyreach.io/api/public";
const TEST_IMAGE_URL = "https://www.gstatic.com/webp/gallery/1.jpg";

async function trySend(
  apiKey: string,
  label: string,
  body: Record<string, unknown>
) {
  console.log(`\n--- Trying: ${label} ---`);
  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch(`${BASE}/Inbox/SendMessage`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    console.log("Response:", JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log("Response (raw):", text || "(empty)");
  }
  return res.status;
}

async function checkHeyReachEndpoints(apiKey: string) {
  // Try to GET the API docs / OpenAPI spec if exposed
  console.log("\n--- Checking HeyReach API for available endpoints ---");
  const endpoints = [
    "/swagger/v1/swagger.json",
    "/openapi.json",
    "/Inbox/SendImageMessage",
    "/Inbox/SendMedia",
    "/Inbox/SendFile",
  ];
  for (const ep of endpoints) {
    const res = await fetch(`${BASE}${ep}`, {
      method: "GET",
      headers: { "X-API-KEY": apiKey },
    });
    console.log(`GET ${ep} → ${res.status}`);
    if (res.status === 200) {
      const text = await res.text();
      console.log("  Response (first 500 chars):", text.slice(0, 500));
    }
  }
}

async function main() {
  const [integrationId, threadId] = process.argv.slice(2);
  if (!integrationId || !threadId) {
    console.error(
      "Usage: bun run scripts/tests/test-heyreach-send-image.ts <integrationId> <threadId>"
    );
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  // Check for any undiscovered endpoints
  await checkHeyReachEndpoints(apiKey);

  // Pull conversationId and linkedInAccountId from thread
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      messages: {
        where: { rawPayload: { not: Prisma.AnyNull } },
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { rawPayload: true },
      },
    },
  });

  let conversationId: string | undefined;
  let linkedInAccountId: number | undefined;

  for (const m of thread.messages) {
    const raw = m.rawPayload as Record<string, unknown> | null;
    if (!raw) continue;
    if (!conversationId) {
      // Try top-level conversationId first, then nested conversation.id
      if (typeof raw.conversationId === "string") conversationId = raw.conversationId;
      else {
        const conv = raw.conversation as Record<string, unknown> | undefined;
        if (typeof conv?.id === "string") conversationId = conv.id;
      }
    }
    if (linkedInAccountId === undefined) {
      const id =
        (raw.linkedInAccountId as number | undefined) ??
        ((raw.linkedInAccount as Record<string, unknown> | undefined)?.id as number | undefined);
      if (typeof id === "number") linkedInAccountId = id;
    }
    if (conversationId && linkedInAccountId !== undefined) break;
  }

  console.log("\nExtracted:", { conversationId, linkedInAccountId });

  if (!conversationId || linkedInAccountId === undefined) {
    console.error("Could not extract conversationId/linkedInAccountId. Aborting.");
    return;
  }

  const base = {
    conversationId,
    linkedInAccountId,
    message: "Attachment probe test — please ignore.",
    subject: "",
  };

  // Test different potential image/media fields
  const variants: Array<[string, Record<string, unknown>]> = [
    ["imageUrl field", { ...base, imageUrl: TEST_IMAGE_URL }],
    ["mediaUrl field", { ...base, mediaUrl: TEST_IMAGE_URL }],
    ["attachmentUrl field", { ...base, attachmentUrl: TEST_IMAGE_URL }],
    [
      "attachments array",
      {
        ...base,
        attachments: [{ url: TEST_IMAGE_URL, type: "image/jpeg", name: "test.jpg" }],
      },
    ],
    [
      "media object",
      {
        ...base,
        media: { url: TEST_IMAGE_URL, type: "image/jpeg" },
      },
    ],
  ];

  for (const [label, body] of variants) {
    const status = await trySend(apiKey, label, body);
    // Stop trying after first 2xx
    if (status >= 200 && status < 300) {
      console.log(`\n✅ SUCCESS with: ${label}`);
      break;
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
