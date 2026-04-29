/**
 * Admin-only password reset.
 *
 *   bun scripts/reset-password.ts <email> <new-password>
 *
 * Connects via whatever DATABASE_URL is in the current env (so it works
 * against both local Docker Postgres and the Vercel/Supabase prod DB —
 * just `export DATABASE_URL=<prod pooler>` before running for prod).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error("Usage: bun scripts/reset-password.ts <email> <new-password>");
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log(`✓ Password reset for ${email}. User can now log in.`);
} finally {
  await prisma.$disconnect();
}
