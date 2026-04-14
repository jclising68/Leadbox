import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/send-email";
import { createSupabaseAdmin } from "@/lib/supabase-server";

/**
 * Start a password reset. We ALWAYS return 200 with a generic message —
 * never reveal whether the email exists. If it does, we create a token
 * (valid for 1 hour) and send a reset link via Supabase Auth (preferred)
 * or Resend (fallback).
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

  const genericSuccess = NextResponse.json({
    ok: true,
    message:
      "If an account exists for that email, you'll receive a password-reset link shortly.",
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return genericSuccess;

  // Always create a VerificationToken — used for validation in both flows.
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

  // ── Preferred path: Supabase Auth sends the recovery email ──────────
  const supabase = createSupabaseAdmin();
  if (supabase) {
    try {
      // Ensure user exists in Supabase Auth (no-op if already there).
      await supabase.auth.admin
        .createUser({
          email,
          password: randomBytes(32).toString("hex"),
          email_confirm: true,
        })
        .catch(() => {}); // "User already registered" is expected

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/reset-password`,
      });

      if (!error) {
        console.log(`[forgot-password] Supabase recovery email sent to ${email}`);
        return genericSuccess;
      }

      console.warn(
        `[forgot-password] Supabase recovery failed: ${error.message}, falling back to Resend`
      );
    } catch (err) {
      console.warn("[forgot-password] Supabase error:", err);
    }
  }

  // ── Fallback: send email via Resend (or log to console) ─────────────
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

  const result = await sendEmail({ to: email, subject, html, text });
  if (!result.sent) {
    console.warn(
      `[forgot-password] Token created but email not sent for ${email} (reason: ${result.error}). Reset URL: ${resetUrl}`
    );
  }

  return genericSuccess;
}
