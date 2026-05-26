// Probe whether Instantly's /emails/reply accepts attachment fields.
// Tries attachment_json and attachments — reports exact API response for each.
//
// Usage: bun run scripts/tests/test-instantly-reply-attachment.ts <integrationId> <replyToUuid> <eaccount>
//
// replyToUuid: the `id` field of an existing email in the thread (from GET /emails)
// eaccount:    the sending mailbox (e.g. stefan.dr@theyfraudio.com)
//
// WARNING: This sends a real reply. Use a test thread / internal email.

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BASE = "https://api.instantly.ai/api/v2";

// Small public test image — used as the attachment URL
const TEST_ATTACHMENT_URL = "https://www.gstatic.com/webp/gallery/1.jpg";

async function tryReply(
  apiKey: string,
  label: string,
  body: Record<string, unknown>
) {
  console.log(`\n--- Trying: ${label} ---`);
  console.log("Request body:", JSON.stringify(body, null, 2));

  const res = await fetch(`${BASE}/emails/reply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    console.log("Response:", JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log("Response (raw):", text);
  }
  return res.status;
}

async function main() {
  const [integrationId, replyToUuid, eaccount] = process.argv.slice(2);
  if (!integrationId || !replyToUuid || !eaccount) {
    console.error(
      "Usage: bun run scripts/tests/test-instantly-reply-attachment.ts <integrationId> <replyToUuid> <eaccount>"
    );
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  const base = {
    reply_to_uuid: replyToUuid,
    eaccount,
    subject: "Re: attachment probe test",
    body: { html: "<p>Attachment probe test — please ignore.</p>" },
  };

  // Test 1: attachment_json (matches the field name in GET /emails responses)
  await tryReply(apiKey, "attachment_json field", {
    ...base,
    attachment_json: {
      files: [
        {
          filename: "test-image.jpg",
          url: TEST_ATTACHMENT_URL,
          size: 12000,
          type: "image/jpeg",
        },
      ],
    },
  });

  // Test 2: attachments array (common REST convention)
  await tryReply(apiKey, "attachments array", {
    ...base,
    attachments: [
      {
        filename: "test-image.jpg",
        url: TEST_ATTACHMENT_URL,
        size: 12000,
        type: "image/jpeg",
      },
    ],
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
