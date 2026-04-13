import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/send-email";

/**
 * Start a password reset. We ALWAYS return 200 with a generic message —
 * never reveal whether the email exists. If it does, we create a token
 * (valid for 1 hour) and email a reset link. If not, we silently no-op.
 */
export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address" },
      { status: 400 }
    );
  }

  // Generic success response regardless of whether the email exists — this
  // prevents using the endpoint to enumerate registered emails.
  const genericSuccess = NextResponse.json({
    ok: true,
    message:
      "If an account exists for that email, you'll receive a password-reset link shortly.",
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return genericSuccess;

  // Invalidate any older outstanding reset tokens for this email so only
  // the newest one works.
  await prisma.verificationToken.deleteMany({
    where: { identifier: `pw-reset:${email}` },
  });

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await prisma.verificationToken.create({
    data: { identifier: `pw-reset:${email}`, token, expires },
  });

  const origin =
    req.nextUrl.origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    "https://leadbox-phi.vercel.app";
  const resetUrl = `${origin}/reset-password?token=${token}`;

  const subject = "Reset your LeadBox password";
  const text = `Hi,

Someone (hopefully you) requested a password reset for your LeadBox account.

To set a new password, open this link in your browser:
${resetUrl}

This link expires in 1 hour. If you didn't request this, you can ignore
this email — your password won't change.

— LeadBox`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 16px">Reset your LeadBox password</h2>
  <p>Someone (hopefully you) requested a password reset for your LeadBox account.</p>
  <p style="margin:24px 0">
    <a href="${resetUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:500">Set a new password</a>
  </p>
  <p style="color:#666;font-size:14px">Or paste this URL into your browser:<br><span style="word-break:break-all">${resetUrl}</span></p>
  <p style="color:#666;font-size:14px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>
  <p style="color:#999;font-size:12px;margin-top:32px">— LeadBox</p>
</div>`;

  // Fire the email but don't let a send failure block the reset flow.
  const result = await sendEmail({ to: email, subject, html, text });
  if (!result.sent) {
    console.warn(
      `[forgot-password] Token created but email not sent for ${email} (reason: ${result.error}). Reset URL: ${resetUrl}`
    );
  }

  return genericSuccess;
}
