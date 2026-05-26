import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    const now = new Date();

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://leadbox-leadassassin.vercel.app";

    const workspaces = await prisma.workspace.findMany({
      where: { slackWebhookUrl: { not: null } },
      select: { id: true, name: true, slug: true, slackWebhookUrl: true },
    });

    for (const ws of workspaces) {
      const threads = await prisma.thread.findMany({
        where: {
          workspaceId: ws.id,
          followUpAt: { not: null, lte: now },
          followUpSlackSentAt: null,
          status: "OPEN",
        },
        select: {
          id: true,
          followUpAt: true,
          prospect: {
            select: { firstName: true, lastName: true, email: true, company: true },
          },
        },
        orderBy: { followUpAt: "asc" },
        take: 20,
      });

      if (!threads.length) continue;

      const lines = threads
        .map((t) => {
          const name =
            [t.prospect.firstName, t.prospect.lastName].filter(Boolean).join(" ").trim() ||
            t.prospect.email ||
            "Unknown";
          const company = t.prospect.company ? ` · ${t.prospect.company}` : "";
          const due = t.followUpAt
            ? new Date(t.followUpAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "";
          const url = `${baseUrl}/ws/${ws.slug}/inbox?thread=${t.id}`;
          return `• *<${url}|${name}>*${company} — due ${due}`;
        })
        .join("\n");

      const payload = {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🔔 ${threads.length} Follow-up${threads.length > 1 ? "s" : ""} Due — ${ws.name}`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: lines },
          },
        ],
      };

      try {
        const res = await fetch(ws.slackWebhookUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error(
            `[follow-up-notify] Slack POST failed for workspace ${ws.id}: HTTP ${res.status}`
          );
          continue;
        }
      } catch (err) {
        console.error(
          `[follow-up-notify] Slack POST error for workspace ${ws.id}:`,
          err instanceof Error ? err.message : err
        );
        continue;
      }

      await prisma.thread.updateMany({
        where: { id: { in: threads.map((t) => t.id) } },
        data: { followUpSlackSentAt: now },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
