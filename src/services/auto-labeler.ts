import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/services/lead-activity";
import { decrypt } from "@/lib/crypto";
import { CLASSIFICATION_PROMPT } from "@/lib/constants";

type ClassificationResult = {
  label: string;
  confidence: number;
};

const VALID_LABELS = [
  "INTERESTED",
  "NOT_INTERESTED",
  "MEETING_BOOKED",
  "QUALIFYING",
  "WRONG_PERSON",
  "OUT_OF_OFFICE",
  "MAYBE_FUTURE",
  "AUTO_REPLY",
  "NEUTRAL",
] as const;

export async function classifyMessage(
  workspaceId: string,
  messageId: string
): Promise<ClassificationResult | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      aiLabelProvider: true,
      openaiKey: true, openaiKeyIv: true, openaiKeyTag: true,
      claudeKey: true, claudeKeyIv: true, claudeKeyTag: true,
    },
  });

  const provider = workspace?.aiLabelProvider ?? "openai";

  if (provider === "claude") {
    if (!workspace?.claudeKey || !workspace.claudeKeyIv || !workspace.claudeKeyTag) {
      const globalKey = process.env.ANTHROPIC_API_KEY;
      if (!globalKey) return null;
      return classifyWithClaude(globalKey, messageId);
    }
    const apiKey = decrypt(workspace.claudeKey, workspace.claudeKeyIv, workspace.claudeKeyTag);
    return classifyWithClaude(apiKey, messageId);
  }

  // Default: OpenAI
  if (!workspace?.openaiKey || !workspace.openaiKeyIv || !workspace.openaiKeyTag) {
    const globalKey = process.env.OPENAI_API_KEY;
    if (!globalKey) return null;
    return classifyWithOpenAI(globalKey, messageId);
  }

  const apiKey = decrypt(workspace.openaiKey, workspace.openaiKeyIv, workspace.openaiKeyTag);
  return classifyWithOpenAI(apiKey, messageId);
}

async function fetchMessageContext(messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      thread: {
        include: {
          messages: {
            orderBy: { receivedAt: "desc" },
            take: 3,
          },
        },
      },
    },
  });

  if (!message) return null;

  const content = message.bodyText || message.messageText || message.subject || "";
  if (!content.trim()) return null;

  const context = message.thread.messages
    .reverse()
    .map((m) => {
      const dir = m.direction === "OUTBOUND" ? "Us" : "Prospect";
      const text = m.bodyText || m.messageText || m.subject || "";
      return `${dir}: ${text.slice(0, 500)}`;
    })
    .join("\n\n");

  return context;
}

function validateResult(result: ClassificationResult): ClassificationResult | null {
  if (!VALID_LABELS.includes(result.label as (typeof VALID_LABELS)[number])) return null;
  if (result.confidence < 0 || result.confidence > 1) return null;
  return result;
}

async function classifyWithOpenAI(
  apiKey: string,
  messageId: string
): Promise<ClassificationResult | null> {
  const context = await fetchMessageContext(messageId);
  if (!context) return null;

  const openai = new OpenAI({ apiKey });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        { role: "user", content: `Classify this prospect's latest reply:\n\n${context}` },
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;

    return validateResult(JSON.parse(raw) as ClassificationResult);
  } catch (error) {
    console.error("OpenAI classification error:", error);
    return null;
  }
}

async function classifyWithClaude(
  apiKey: string,
  messageId: string
): Promise<ClassificationResult | null> {
  const context = await fetchMessageContext(messageId);
  if (!context) return null;

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      system: CLASSIFICATION_PROMPT,
      messages: [
        { role: "user", content: `Classify this prospect's latest reply:\n\n${context}` },
      ],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!raw) return null;

    // Claude may wrap JSON in markdown fences — strip them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    return validateResult(JSON.parse(cleaned) as ClassificationResult);
  } catch (error) {
    console.error("Claude classification error:", error);
    return null;
  }
}

// Map classification label back to display name
export function classificationToLabelName(classification: string): string {
  const map: Record<string, string> = {
    INTERESTED: "Interested",
    NOT_INTERESTED: "Not Interested",
    MEETING_BOOKED: "Meeting Booked",
    QUALIFYING: "Qualifying",
    WRONG_PERSON: "Wrong Person",
    OUT_OF_OFFICE: "Out of Office",
    MAYBE_FUTURE: "Maybe Future",
    AUTO_REPLY: "Auto Reply",
    NEUTRAL: "Neutral",
  };
  return map[classification] || classification;
}

export async function applyAutoLabel(
  workspaceId: string,
  threadId: string,
  labelName: string,
  confidence: number,
  source: "AUTO_AI" | "WEBHOOK" = "AUTO_AI"
): Promise<void> {
  const label = await prisma.label.findUnique({
    where: { workspaceId_name: { workspaceId, name: labelName } },
  });

  if (!label) return;

  // Replace any previous auto-applied labels — only the latest classification
  // should be active. MANUAL labels are never touched.
  await prisma.threadLabel.deleteMany({
    where: { threadId, source: { in: ["AUTO_AI", "WEBHOOK"] } },
  });

  // Use create + catch P2002: if a MANUAL label with the same (threadId, labelId)
  // already exists, deleteMany won't remove it, and the create would fail with a
  // unique constraint error. Catching P2002 means we skip silently — the label is
  // already correctly set, so no action needed. Also handles concurrent webhook
  // retries where two requests race to create the same label.
  try {
    await prisma.threadLabel.create({
      data: { threadId, labelId: label.id, source, confidence },
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return;
    }
    throw err;
  }

  logActivity(workspaceId, threadId, null, "label_applied", { label: label.name });
}
