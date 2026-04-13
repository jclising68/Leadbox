import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Complete the password reset flow. Accepts a one-time token (created by
 * /api/auth/forgot-password) and a new password. Validates the token,
 * updates the user's password hash, and invalidates the token.
 */
export async function POST(req: NextRequest) {
  let token: string;
  let password: string;
  try {
    const body = (await req.json()) as { token?: string; password?: string };
    token = (body.token || "").trim();
    password = body.password || "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!token || !password) {
    return NextResponse.json(
      { error: "Reset link and new password are both required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
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
    // Token existed but the user was deleted — clean up and fail gracefully.
    await prisma.verificationToken.delete({ where: { token } });
    return NextResponse.json(
      { error: "Account not found" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  // One-shot token — delete after use, and purge any siblings.
  await prisma.verificationToken.deleteMany({
    where: { identifier: `pw-reset:${email}` },
  });

  return NextResponse.json({
    ok: true,
    message: "Password updated. You can now sign in.",
  });
}
