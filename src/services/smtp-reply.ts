import { createHash } from "node:crypto";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

function resolveAttachmentPath(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return join(process.cwd(), "public", url);
}

function computeSmtpExternalId(threadId: string, body: string): string {
  const bucket = Math.floor(Date.now() / 30_000);
  const hash = createHash("sha1")
    .update(`smtp|${threadId}|${body}|${bucket}`)
    .digest("hex")
    .slice(0, 16);
  return `smtp_${threadId}_${hash}`;
}

export type SmtpAttachment = {
  name: string;
  url: string;
  type: string;
};

export async function replyViaSmtp(
  workspaceId: string,
  threadId: string,
  bodyHtml: string,
  attachments: SmtpAttachment[]
): Promise<{ messageId: string }> {
  const thread = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      prospect: { select: { email: true } },
      messages: {
        where: { externalId: { not: null } },
        orderBy: { sentAt: "desc" },
        take: 25,
        select: {
          externalId: true,
          direction: true,
          fromEmail: true,
          toEmail: true,
          subject: true,
          rawPayload: true,
          integrationId: true,
        },
      },
    },
  });

  const prospectEmail = thread.prospect.email;
  if (!prospectEmail) throw new Error("Prospect has no email address");

  // Derive sending address (same logic as instantly-reply)
  const prospectLower = prospectEmail.toLowerCase();
  let fromEmail: string | undefined;
  for (const m of thread.messages) {
    const candidate = m.direction === "OUTBOUND" ? m.fromEmail : m.toEmail;
    if (candidate && candidate.toLowerCase() !== prospectLower) {
      fromEmail = candidate;
      break;
    }
  }
  if (!fromEmail) throw new Error("Could not determine sending email for this thread");

  // Look up SMTP channel for this sending address
  const channel = await prisma.smtpChannel.findUnique({
    where: { workspaceId_email: { workspaceId, email: fromEmail } },
  });
  if (!channel) {
    throw new Error(
      `No SMTP channel configured for ${fromEmail}. Import your mailboxes in Settings → Channels.`
    );
  }

  // Derive subject
  let subject = "";
  for (const m of thread.messages) {
    const s = m.subject?.trim();
    if (s) {
      subject = /^re:\s/i.test(s) ? s : `Re: ${s}`;
      break;
    }
  }
  if (!subject) subject = "Re:";

  const smtpPass = decrypt(channel.smtpPassEncrypted, channel.smtpPassIv, channel.smtpPassTag);

  const transporter = nodemailer.createTransport({
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.smtpSecure,
    auth: { user: channel.smtpUser, pass: smtpPass },
    // Conservative timeout — Vercel functions have a 30s execution limit
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const mailAttachments = attachments.map((a) => ({
    filename: a.name,
    path: resolveAttachmentPath(a.url),
    contentType: a.type,
  }));

  await transporter.sendMail({
    from: channel.displayName ? `${channel.displayName} <${fromEmail}>` : fromEmail,
    to: prospectEmail,
    subject,
    html: bodyHtml,
    attachments: mailAttachments,
  });

  // Record in DB
  const integrationId = thread.messages.find((m) => m.integrationId)?.integrationId ?? null;
  const externalId = computeSmtpExternalId(threadId, bodyHtml.trim());

  let message;
  try {
    message = await prisma.message.create({
      data: {
        workspaceId,
        threadId,
        integrationId,
        direction: "OUTBOUND",
        channel: "EMAIL",
        fromEmail,
        toEmail: prospectEmail,
        subject,
        bodyHtml,
        bodyText: bodyHtml.replace(/<[^>]+>/g, "").trim(),
        externalId,
        sentAt: new Date(),
        receivedAt: new Date(),
        rawPayload: attachments.length
          ? { attachments: attachments.map((a) => ({ name: a.name, url: a.url, type: a.type })) }
          : undefined,
      },
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const winner = await prisma.message.findUniqueOrThrow({
        where: { externalId_workspaceId: { externalId, workspaceId } },
      });
      return { messageId: winner.id };
    }
    throw err;
  }

  const snippet = bodyHtml.replace(/<[^>]+>/g, "").trim().slice(0, 200);
  await prisma.thread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date(), snippet, messageCount: { increment: 1 }, isUnread: false },
  });

  return { messageId: message.id };
}
