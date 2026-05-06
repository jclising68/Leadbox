/**
 * LeadBox MCP Server
 *
 * Exposes LeadBox inbox actions as MCP tools for AI agents (e.g. Sofia via Hermes AI).
 * Auth: Bearer token in Authorization header, resolved to a workspace via WorkspaceApiKey.
 * Transport: WebStandardStreamableHTTPServerTransport in stateless mode (Vercel-safe).
 *
 * Tools: list_threads, get_thread, send_reply, apply_label, mark_thread_read, unsubscribe_contact
 */
import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { prisma } from "@/lib/prisma";
import { replyViaInstantly } from "@/services/instantly-reply";
import { replyViaHeyreach } from "@/services/heyreach-reply";
import { decrypt } from "@/lib/crypto";
import { createHash } from "crypto";
import { z } from "zod";

async function resolveWorkspace(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const raw = auth.slice(7).trim();
  const hash = createHash("sha256").update(raw).digest("hex");

  const key = await prisma.workspaceApiKey.findFirst({
    where: { keyHash: hash, revokedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!key) return null;

  // Update last used timestamp (fire-and-forget)
  prisma.workspaceApiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return key.workspaceId;
}

async function buildMcpServer(workspaceId: string): Promise<McpServer> {
  const server = new McpServer({
    name: "leadbox",
    version: "1.0.0",
  });

  // ── list_threads ─────────────────────────────────────────────────────────
  server.tool(
    "list_threads",
    "List inbox threads for the workspace. Defaults to open unread threads.",
    {
      status: z.enum(["OPEN", "ARCHIVED", "ALL"]).optional().describe("Thread status filter (OPEN, ARCHIVED, ALL)"),
      unread_only: z.boolean().optional().describe("Only return unread threads"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
      label: z.string().optional().describe("Filter by label name"),
    },
    async ({ status = "OPEN", unread_only = true, limit = 20, label }) => {
      const threads = await prisma.thread.findMany({
        where: {
          workspaceId,
          ...(status !== "ALL" ? { status: status as "OPEN" | "ARCHIVED" } : {}),
          ...(unread_only ? { isUnread: true } : {}),
          ...(label
            ? { threadLabels: { some: { label: { name: { equals: label, mode: "insensitive" } } } } }
            : {}),
        },
        include: {
          prospect: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              linkedinUrl: true,
              company: true,
              isUnsubscribed: true,
            },
          },
          threadLabels: {
            include: { label: { select: { name: true } } },
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: limit,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              threads.map((t) => ({
                id: t.id,
                channel: t.channel,
                status: t.status,
                isUnread: t.isUnread,
                lastMessageAt: t.lastMessageAt,
                messageCount: t.messageCount,
                prospect: t.prospect,
                labels: t.threadLabels.map((tl: { label: { name: string } }) => tl.label.name),
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── get_thread ────────────────────────────────────────────────────────────
  server.tool(
    "get_thread",
    "Get messages in a specific thread.",
    {
      thread_id: z.string().describe("Thread ID"),
      limit: z.number().int().min(1).max(50).optional().describe("Max messages (default 20)"),
    },
    async ({ thread_id, limit = 20 }) => {
      const thread = await prisma.thread.findFirst({
        where: { id: thread_id, workspaceId },
        include: {
          prospect: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              company: true,
              isUnsubscribed: true,
            },
          },
          messages: {
            orderBy: { receivedAt: "asc" },
            take: limit,
            select: {
              id: true,
              direction: true,
              bodyText: true,
              messageText: true,
              subject: true,
              fromEmail: true,
              toEmail: true,
              linkedinFrom: true,
              linkedinTo: true,
              sentAt: true,
              receivedAt: true,
            },
          },
        },
      });

      if (!thread) {
        return {
          content: [{ type: "text" as const, text: "Thread not found." }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(thread, null, 2),
          },
        ],
      };
    }
  );

  // ── send_reply ────────────────────────────────────────────────────────────
  server.tool(
    "send_reply",
    "Send a reply to a thread via Instantly (email) or HeyReach (LinkedIn).",
    {
      thread_id: z.string().describe("Thread ID to reply to"),
      message: z.string().min(1).describe("Reply message body"),
    },
    async ({ thread_id, message }) => {
      const thread = await prisma.thread.findFirst({
        where: { id: thread_id, workspaceId },
        select: { id: true, channel: true },
      });

      if (!thread) {
        return { content: [{ type: "text" as const, text: "Thread not found." }], isError: true };
      }

      // Find the owning integration
      const lastMsg = await prisma.message.findFirst({
        where: { threadId: thread_id, integrationId: { not: null } },
        orderBy: { sentAt: "desc" },
        select: { integrationId: true },
      });

      let integration = lastMsg?.integrationId
        ? await prisma.integration.findFirst({
            where: { id: lastMsg.integrationId, isActive: true },
          })
        : null;

      if (!integration) {
        const provider = thread.channel === "EMAIL" ? "INSTANTLY" : "HEYREACH";
        integration = await prisma.integration.findFirst({
          where: { workspaceId, provider, isActive: true },
        });
      }

      if (!integration) {
        return {
          content: [{ type: "text" as const, text: "No active integration found for this thread." }],
          isError: true,
        };
      }

      try {
        if (thread.channel === "EMAIL") {
          await replyViaInstantly(integration.id, thread_id, message);
        } else {
          await replyViaHeyreach(integration.id, thread_id, message);
        }
        return { content: [{ type: "text" as const, text: "Reply sent successfully." }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to send reply: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── apply_label ───────────────────────────────────────────────────────────
  server.tool(
    "apply_label",
    "Apply a label to a thread by label name.",
    {
      thread_id: z.string().describe("Thread ID"),
      label_name: z.string().describe("Exact label name to apply"),
    },
    async ({ thread_id, label_name }) => {
      const thread = await prisma.thread.findFirst({
        where: { id: thread_id, workspaceId },
        select: { id: true },
      });
      if (!thread) {
        return { content: [{ type: "text" as const, text: "Thread not found." }], isError: true };
      }

      const label = await prisma.label.findFirst({
        where: { workspaceId, name: { equals: label_name, mode: "insensitive" } },
      });
      if (!label) {
        return {
          content: [{ type: "text" as const, text: `Label "${label_name}" not found in this workspace.` }],
          isError: true,
        };
      }

      await prisma.threadLabel.upsert({
        where: { threadId_labelId: { threadId: thread_id, labelId: label.id } },
        update: { source: "MANUAL", appliedAt: new Date() },
        create: { threadId: thread_id, labelId: label.id, source: "MANUAL" },
      });

      return { content: [{ type: "text" as const, text: `Label "${label.name}" applied.` }] };
    }
  );

  // ── mark_thread_read ──────────────────────────────────────────────────────
  server.tool(
    "mark_thread_read",
    "Mark a thread as read.",
    { thread_id: z.string().describe("Thread ID") },
    async ({ thread_id }) => {
      const updated = await prisma.thread.updateMany({
        where: { id: thread_id, workspaceId },
        data: { isUnread: false },
      });
      if (updated.count === 0) {
        return { content: [{ type: "text" as const, text: "Thread not found." }], isError: true };
      }
      return { content: [{ type: "text" as const, text: "Thread marked as read." }] };
    }
  );

  // ── unsubscribe_contact ───────────────────────────────────────────────────
  server.tool(
    "unsubscribe_contact",
    "Unsubscribe a contact by their prospect ID. Syncs to Instantly for email contacts.",
    { prospect_id: z.string().describe("Prospect ID to unsubscribe") },
    async ({ prospect_id }) => {
      const prospect = await prisma.prospect.findFirst({
        where: { id: prospect_id, workspaceId },
        select: {
          id: true,
          email: true,
          isUnsubscribed: true,
          thread: {
            select: {
              messages: {
                where: { campaignId: { not: null } },
                orderBy: { receivedAt: "desc" },
                take: 1,
                select: { campaignId: true },
              },
            },
          },
        },
      });

      if (!prospect) {
        return { content: [{ type: "text" as const, text: "Prospect not found." }], isError: true };
      }
      if (prospect.isUnsubscribed) {
        return { content: [{ type: "text" as const, text: "Contact is already unsubscribed." }] };
      }

      await prisma.prospect.update({
        where: { id: prospect_id },
        data: { isUnsubscribed: true, unsubscribedAt: new Date() },
      });

      const campaignId = prospect.thread?.messages[0]?.campaignId;
      if (prospect.email && campaignId) {
        const integrations = await prisma.integration.findMany({
          where: { workspaceId, provider: "INSTANTLY", isActive: true },
          select: { apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true },
        });
        await Promise.allSettled(
          integrations.map(async (intg) => {
            const apiKey = decrypt(intg.apiKeyEncrypted, intg.apiKeyIv, intg.apiKeyTag);
            await fetch("https://api.instantly.ai/api/v1/lead/update/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                api_key: apiKey,
                campaign_id: campaignId,
                email: prospect.email,
                new_status: "Unsubscribed",
              }),
            });
          })
        );
      }

      return { content: [{ type: "text" as const, text: "Contact unsubscribed successfully." }] };
    }
  );

  return server;
}

async function handleMcp(req: NextRequest): Promise<Response> {
  const workspaceId = await resolveWorkspace(req);
  if (!workspaceId) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing API key" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const server = await buildMcpServer(workspaceId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
