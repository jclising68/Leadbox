import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export async function generateReplyDraft(
  workspaceId: string,
  threadId: string
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      aiReplyEnabled: true,
      aiReplyMode: true,
      aiReplyProvider: true,
      claudeKey: true,
      claudeKeyIv: true,
      claudeKeyTag: true,
      openaiKey: true,
      openaiKeyIv: true,
      openaiKeyTag: true,
      aiReplyInstructions: true,
    },
  });

  if (!workspace?.aiReplyEnabled) return;

  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      prospect: {
        select: {
          firstName: true,
          lastName: true,
          company: true,
          title: true,
          isUnsubscribed: true,
        },
      },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          direction: true,
          bodyText: true,
          messageText: true,
          subject: true,
          sentAt: true,
          campaignName: true,
        },
      },
    },
  });

  if (!thread) return;
  if (thread.prospect.isUnsubscribed) return;

  // Check if there's already a READY or SENT draft — don't overwrite
  const existing = await prisma.aiDraft.findUnique({ where: { threadId } });
  if (existing?.status === "READY" || existing?.status === "SENT") return;

  // Mark PENDING so the UI can show a spinner
  await prisma.aiDraft.upsert({
    where: { threadId },
    create: { threadId, workspaceId, body: "", model: "", status: "PENDING" },
    update: { status: "PENDING", body: "", model: "" },
  });

  try {
    const { prospect, messages } = thread;
    const campaignName = messages.find((m) => m.campaignName)?.campaignName;

    const conversationText = messages
      .map((m) => {
        const role = m.direction === "OUTBOUND" ? "Us" : "Lead";
        const text = m.bodyText || m.messageText || m.subject || "";
        return `${role}: ${text.slice(0, 600)}`;
      })
      .join("\n\n");

    const prospectLines = [
      prospect.firstName || prospect.lastName
        ? `Name: ${[prospect.firstName, prospect.lastName].filter(Boolean).join(" ")}`
        : null,
      prospect.company ? `Company: ${prospect.company}` : null,
      prospect.title ? `Title: ${prospect.title}` : null,
      campaignName ? `Campaign: ${campaignName}` : null,
    ].filter(Boolean);

    const systemPrompt = [
      workspace.aiReplyInstructions ||
        "You are a professional sales representative drafting email replies.",
      "Draft a reply to the lead's most recent message. Be natural, concise, and directly address what they said.",
      "Return only the reply body — no subject line, no signature placeholder, no meta-commentary.",
    ].join("\n\n");

    const userPrompt = prospectLines.length
      ? `Lead info:\n${prospectLines.join("\n")}\n\nConversation:\n${conversationText}`
      : `Conversation:\n${conversationText}`;

    let draftBody = "";
    let modelUsed = "";

    if (workspace.aiReplyProvider === "claude") {
      if (!workspace.claudeKey || !workspace.claudeKeyIv || !workspace.claudeKeyTag) {
        console.warn(`[ai-reply] Claude provider selected but no key configured for workspace ${workspaceId}`);
        await prisma.aiDraft.delete({ where: { threadId } }).catch(() => {});
        return;
      }
      const apiKey = decrypt(workspace.claudeKey, workspace.claudeKeyIv, workspace.claudeKeyTag);
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      draftBody =
        response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      modelUsed = "claude-sonnet-4-6";
    } else {
      // OpenAI (default)
      let apiKey: string | undefined = process.env.OPENAI_API_KEY;
      if (workspace.openaiKey && workspace.openaiKeyIv && workspace.openaiKeyTag) {
        apiKey = decrypt(workspace.openaiKey, workspace.openaiKeyIv, workspace.openaiKeyTag);
      }
      if (!apiKey) {
        console.warn(`[ai-reply] No OpenAI key configured for workspace ${workspaceId}`);
        await prisma.aiDraft.delete({ where: { threadId } }).catch(() => {});
        return;
      }
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      draftBody = response.choices[0]?.message?.content?.trim() || "";
      modelUsed = "gpt-4o-mini";
    }

    if (!draftBody) {
      await prisma.aiDraft.delete({ where: { threadId } }).catch(() => {});
      return;
    }

    await prisma.aiDraft.update({
      where: { threadId },
      data: { body: draftBody, model: modelUsed, status: "READY" },
    });

    // Auto-reply mode — send immediately
    if (workspace.aiReplyMode === "AUTO_REPLY") {
      const { replyViaInstantly } = await import("@/services/instantly-reply");
      const { replyViaHeyreach } = await import("@/services/heyreach-reply");

      const fullThread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: {
          messages: {
            orderBy: { receivedAt: "desc" },
            take: 5,
            include: { integration: { select: { id: true } } },
          },
        },
      });

      if (!fullThread) return;

      const integrationId = fullThread.messages.find((m) => m.integration)?.integration?.id;
      if (!integrationId) {
        console.warn(`[ai-reply] No integration found for thread ${threadId}, skipping auto-reply`);
        return;
      }

      try {
        if (fullThread.channel === "EMAIL") {
          await replyViaInstantly(integrationId, threadId, draftBody.replace(/\n/g, "<br>"));
        } else {
          await replyViaHeyreach(integrationId, threadId, draftBody);
        }
        await prisma.aiDraft.update({ where: { threadId }, data: { status: "SENT" } });
      } catch (err) {
        console.error("[ai-reply] Auto-reply send failed:", err instanceof Error ? err.message : err);
        // Leave as READY so the team can review and send manually
      }
    }
  } catch (err) {
    console.error("[ai-reply] Draft generation failed:", err instanceof Error ? err.message : err);
    await prisma.aiDraft.delete({ where: { threadId } }).catch(() => {});
  }
}
