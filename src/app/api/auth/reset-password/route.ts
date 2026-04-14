import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdmin } from "@/lib/supabase-server";

/**
 * Complete the password reset. Supports two flows:
 *
 * 1. **Supabase recovery** — client sends `{ email, password, supabaseFlow: true }`.
 *    Validated by checking a live VerificationToken for `pw-reset:<email>` AND
 *    optionally verifying the Supabase access token via the admin client.
 *
 * 2. **Legacy token** — client sends `{ token, password }`.
 *    Validated by looking up the VerificationToken directly.
 */
export async function POST(req: NextRequest) {
  let body: {
    token?: string;
    email?: string;
    password?: string;
    supabaseFlow?: boolean;
    supabaseToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const password = body.password || "";
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // ── Supabase recovery flow ──────────────────────────────────────────
  if (body.supabaseFlow && body.email) {
    const email = body.email.trim().toLowerCase();

    // Verify via Supabase access token — REQUIRED for supabaseFlow
    if (body.supabaseToken) {
      const supabase = createSupabaseAdmin();
      if (!supabase) {
        return NextResponse.json(
          { error: "Recovery service unavailable" },
          { status: 500 }
        );
      }
      const { data, error } = await supabase.auth.getUser(body.supabaseToken);
      if (error || data.user?.email?.toLowerCase() !== email) {
        return NextResponse.json(
          { error: "Invalid recovery session" },
          { status: 401 }
        );
      }
    } else {
      // supabaseFlow without a token is not allowed
      return NextResponse.json(
        { error: "Invalid recovery session" },
        { status: 401 }
      );
    }

    // Secondary check: a VerificationToken must exist for this email
    // (created during the forgot-password step).
    const record = await prisma.verificationToken.findFirst({
      where: {
        identifier: `pw-reset:${email}`,
        expires: { gt: new Date() },
      },
    });

    if (!record) {
      return NextResponse.json(
        { error: "Reset session expired. Please request a new link." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Account not found" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await prisma.verificationToken.deleteMany({
      where: { identifier: `pw-reset:${email}` },
    });

    return NextResponse.json({
      ok: true,
      message: "Password updated. You can now sign in.",
    });
  }

  // ── Legacy token flow ───────────────────────────────────────────────
  const token = (body.token || "").trim();
  if (!token) {
    return NextResponse.json(
      { error: "Reset link and new password are both required" },
      { status: 400 }
    );
  }

  const record = await prisma.verificationToken.findUnique({
    where: { token },
  });
  if (
    !record ||
    !record.identifier.startsWith("pw-reset:") ||
    record.expires.getTime() < Date.now()
  ) {
    return NextResponse.json(
      {
        error:
          "This reset link is invalid or has expired. Request a new one from the Forgot password page.",
      },
      { status: 400 }
    );
  }

  const email = record.identifier.slice("pw-reset:".length);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await prisma.verificationToken.delete({ where: { token } });
    return NextResponse.json(
      { error: "Account not found" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  await prisma.verificationToken.deleteMany({
    where: { identifier: `pw-reset:${email}` },
  });

  return NextResponse.json({
    ok: true,
    message: "Password updated. You can now sign in.",
  });
}
