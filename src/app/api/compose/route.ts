import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { decrypt } from "@/lib/crypto";
import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { logActivity } from "@/services/lead-activity";

type Attachment = { name: string; url: string; type: string };

// Relative URLs (local dev fallback) point to public/uploads — resolve to fs path
function resolveAttachmentPath(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return join(process.cwd(), "public", url);
}

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  try {
    const { fromEmail, toEmail, subject, body, attachments } = await req.json() as {
      fromEmail: string;
      toEmail: string;
      subject: string;
      body: string;
      attachments?: Attachment[];
    };

    if (!fromEmail || !toEmail || !body?.trim()) {
      return NextResponse.json({ error: "fromEmail, toEmail, and body are required" }, { status: 400 });
    }

    const channel = await prisma.smtpChannel.findUnique({
      where: { workspaceId_email: { workspaceId: workspaceId!, email: fromEmail } },
    });
    if (!channel) {
      return NextResponse.json(
        { error: `No SMTP channel configured for ${fromEmail}. Add it in Settings → Channels.` },
        { status: 400 }
      );
    }

    const smtpPass = decrypt(channel.smtpPassEncrypted, channel.smtpPassIv, channel.smtpPassTag);
    const transporter = nodemailer.createTransport({
      host: channel.smtpHost,
      port: channel.smtpPort,
      secure: channel.smtpSecure,
      auth: { user: channel.smtpUser, pass: smtpPass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    const mailAttachments = (attachments ?? []).map((a) => ({
      filename: a.name,
      path: resolveAttachmentPath(a.url),
      contentType: a.type,
    }));

    await transporter.sendMail({
      from: channel.displayName ? `${channel.displayName} <${fromEmail}>` : fromEmail,
      to: toEmail,
      subject: subject || "(no subject)",
      html: body.replace(/\n/g, "<br>"),
      attachments: mailAttachments,
    });

    // Upsert prospect (no campaignName → lands in Outbound)
    const toEmailLower = toEmail.toLowerCase().trim();
    const prospect = await prisma.prospect.upsert({
      where: { workspaceId_email: { workspaceId: workspaceId!, email: toEmailLower } },
      update: {},
      create: { workspaceId: workspaceId!, email: toEmailLower },
    });

    let thread = await prisma.thread.findUnique({ where: { prospectId: prospect.id } });
    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          workspaceId: workspaceId!,
          prospectId: prospect.id,
          channel: "EMAIL",
          status: "OPEN",
          isUnread: false,
          lastMessageAt: new Date(),
          messageCount: 1,
          snippet: body.replace(/<[^>]+>/g, "").trim().slice(0, 200),
        },
      });
    } else {
      await prisma.thread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
          snippet: body.replace(/<[^>]+>/g, "").trim().slice(0, 200),
        },
      });
    }

    const externalId = `compose_${createHash("sha1")
      .update(`${thread.id}|${body.trim()}|${Math.floor(Date.now() / 30_000)}`)
      .digest("hex")
      .slice(0, 16)}`;

    try {
      await prisma.message.create({
        data: {
          workspaceId: workspaceId!,
          threadId: thread.id,
          direction: "OUTBOUND",
          channel: "EMAIL",
          fromEmail,
          toEmail: toEmailLower,
          subject: subject || "(no subject)",
          bodyHtml: body.replace(/\n/g, "<br>"),
          bodyText: body.replace(/<[^>]+>/g, "").trim(),
          externalId,
          sentAt: new Date(),
          receivedAt: new Date(),
          rawPayload: attachments?.length
            ? { attachments: attachments.map((a) => ({ name: a.name, url: a.url, type: a.type })) }
            : undefined,
        },
      });
    } catch (err: unknown) {
      if (!(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002")) {
        throw err;
      }
    }

    logActivity(workspaceId!, thread.id, prospect.id, "reply_sent", { subject: subject || "(no subject)" });

    // If thread had a followUpAt, clear it and remove the Follow Up pipeline deal
    if (thread.followUpAt) {
      await Promise.all([
        prisma.thread.update({
          where: { id: thread.id },
          data: { followUpAt: null },
        }),
        prisma.pipelineDeal.deleteMany({
          where: {
            threadId: thread.id,
            workspaceId: workspaceId!,
            stage: { name: "Follow Up" },
          },
        }),
      ]);
    }

    return NextResponse.json({ success: true, threadId: thread.id });
  } catch (err) {
    console.error("[compose]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
