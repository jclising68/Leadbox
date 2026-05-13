// Probe whether Lemlist's send-email endpoint or MCP send_message accepts attachments.
// Tests REST API with attachments field, and MCP send_message with attachments.
//
// Usage: bun run scripts/tests/test-lemlist-send-attachment.ts <integrationId> <threadId>
//
// threadId: a LeadBox thread ID whose messages have Lemlist rawPayload (sendUserId etc.)
//
// WARNING: This sends a real email. Use a test thread / internal lead.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const LEMLIST_MCP_URL = "https://app.lemlist.com/mcp";
const LEMLIST_REST_BASE = "https://api.lemlist.com/api";

// Small public test image
const TEST_IMAGE_URL = "https://www.gstatic.com/webp/gallery/1.jpg";
// Small public PDF
const TEST_PDF_URL =
  "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-notes.pdf";

async function tryMcpSendMessage(
  apiKey: string,
  args: Record<string, unknown>,
  label: string
) {
  console.log(`\n--- MCP send_message: ${label} ---`);
  console.log("Args:", JSON.stringify(args, null, 2));

  const res = await fetch(LEMLIST_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "send_message", arguments: args },
    }),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    console.log("Response:", JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log("Response (raw):", text);
  }
}

async function tryRestSendEmail(
  apiKey: string,
  body: Record<string, unknown>,
  label: string
) {
  console.log(`\n--- REST send-email: ${label} ---`);
  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch(`${LEMLIST_REST_BASE}/v2/inbox/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
}

async function tryMcpListTools(apiKey: string) {
  console.log("\n--- MCP tools/list (checking available tools + schemas) ---");
  const res = await fetch(LEMLIST_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    const data = JSON.parse(text) as {
      result?: { tools?: { name: string; inputSchema?: unknown }[] };
    };
    const tools = data.result?.tools ?? [];
    for (const t of tools) {
      console.log(`\nTool: ${t.name}`);
      console.log("Schema:", JSON.stringify(t.inputSchema, null, 2));
    }
  } catch {
    console.log("Response (raw):", text);
  }
}

async function main() {
  const [integrationId, threadId] = process.argv.slice(2);
  if (!integrationId || !threadId) {
    console.error(
      "Usage: bun run scripts/tests/test-lemlist-send-attachment.ts <integrationId> <threadId>"
    );
    process.exit(1);
  }

  const row = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const apiKey = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);

  // Step 1: Get the actual MCP tool schema — shows if attachments param exists
  await tryMcpListTools(apiKey);

  // Step 2: Pull thread messages to extract sendUserId, contactId, etc.
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true } },
      messages: {
        where: { rawPayload: { not: Prisma.AnyNull } },
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { rawPayload: true, subject: true, direction: true },
      },
    },
  });

  let sendUserId: string | undefined;
  let sendUserEmail: string | undefined;
  let sendUserMailboxId: string | undefined;
  let contactId: string | undefined;
  let leadId: string | undefined;
  let subject = "Re: attachment probe";

  for (const m of thread.messages) {
    const raw = m.rawPayload as Record<string, unknown> | null;
    if (!raw) continue;
    if (!sendUserId && typeof raw.sendUserId === "string") sendUserId = raw.sendUserId;
    if (!sendUserEmail && typeof raw.sendUserEmail === "string") sendUserEmail = raw.sendUserEmail;
    if (!sendUserMailboxId && typeof raw.sendUserMailboxId === "string") sendUserMailboxId = raw.sendUserMailboxId;
    if (!contactId && typeof raw.contactId === "string") contactId = raw.contactId;
    if (!leadId && typeof raw.leadId === "string") leadId = raw.leadId;
    if (m.subject) subject = m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`;
    if (sendUserId && sendUserEmail && sendUserMailboxId && contactId) break;
  }

  console.log("\nExtracted fields:", { sendUserId, sendUserEmail, sendUserMailboxId, contactId, leadId });

  if (!sendUserId || !contactId || !sendUserEmail || !sendUserMailboxId) {
    console.error("Could not extract required fields from thread messages. Aborting send tests.");
    return;
  }

  const baseArgs = {
    channel: "email",
    sendUserId,
    contactId,
    sendUserEmail,
    sendUserMailboxId,
    subject,
    message: "<p>Attachment probe test — please ignore.</p>",
  };

  // Test 3a: MCP send_message with attachments field
  await tryMcpSendMessage(
    apiKey,
    {
      ...baseArgs,
      attachments: [
        { name: "test-image.jpg", url: TEST_IMAGE_URL, size: 12000, type: "image/jpeg" },
      ],
    },
    "with attachments field (image)"
  );

  // Test 3b: REST send-email with attachments field
  if (leadId) {
    await tryRestSendEmail(
      apiKey,
      {
        sendUserId,
        sendUserEmail,
        sendUserMailboxId,
        contactId,
        leadId,
        subject,
        message: "<p>Attachment probe test — please ignore.</p>",
        attachments: [
          { name: "test-image.jpg", url: TEST_IMAGE_URL, size: 12000, type: "image/jpeg" },
        ],
      },
      "with attachments field (image)"
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
