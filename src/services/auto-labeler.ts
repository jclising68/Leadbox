import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { CLASSIFICATION_PROMPT } from "@/lib/constants";

type ClassificationResult = {
  label: string;
  confidence: number;
};

export async function classifyMessage(
  workspaceId: string,
  messageId: string
): Promise<ClassificationResult | null> {
  // Get workspace OpenAI key
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace?.openaiKey || !workspace.openaiKeyIv || !workspace.openaiKeyTag) {
    // Try global key
    const globalKey = process.env.OPENAI_API_KEY;
    if (!globalKey) return null;
    return classifyWithKey(globalKey, messageId);
  }

  const apiKey = decrypt(workspace.openaiKey, workspace.openaiKeyIv, workspace.openaiKeyTag);
  return classifyWithKey(apiKey, messageId);
}

async function classifyWithKey(
  apiKey: string,
  messageId: string
): Promise<ClassificationResult | null> {
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

  // Build context from recent messages
  const context = message.thread.messages
    .reverse()
    .map((m) => {
      const dir = m.direction === "OUTBOUND" ? "Us" : "Prospect";
      const text = m.bodyText || m.messageText || m.subject || "";
      return `${dir}: ${text.slice(0, 500)}`;
    })
    .join("\n\n");

  const openai = new OpenAI({ apiKey });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        {
          role: "user",
          content: `Classify this prospect's latest reply:\n\n${context}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;

    const result = JSON.parse(raw) as ClassificationResult;

    // Validate
    const validLabels = [
      "INTERESTED",
      "NOT_INTERESTED",
      "MEETING_BOOKED",
      "QUALIFYING",
      "WRONG_PERSON",
      "OUT_OF_OFFICE",
      "MAYBE_FUTURE",
      "AUTO_REPLY",
      "NEUTRAL",
    ];

    if (!validLabels.includes(result.label)) return null;
    if (result.confidence < 0 || result.confidence > 1) return null;

    return result;
  } catch (error) {
    console.error("OpenAI classification error:", error);
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

  await prisma.threadLabel.create({
    data: {
      threadId,
      labelId: label.id,
      source,
      confidence,
    },
  });
}
