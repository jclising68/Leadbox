import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { encrypt } from "@/lib/crypto";

// GET — list all SMTP channels for the workspace
export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const channels = await prisma.smtpChannel.findMany({
    where: { workspaceId: workspaceId! },
    select: {
      id: true,
      email: true,
      displayName: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUser: true,
      createdAt: true,
    },
    orderBy: { email: "asc" },
  });

  return NextResponse.json({ channels });
}

// POST — bulk import from CSV rows
// Body: { channels: Array<{ email, displayName?, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass }> }
export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { channels } = await req.json() as {
    channels: Array<{
      email: string;
      displayName?: string;
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPass: string;
    }>;
  };

  if (!Array.isArray(channels) || channels.length === 0) {
    return NextResponse.json({ error: "No channels provided" }, { status: 400 });
  }

  // Encrypt and upsert in batches to avoid huge single transactions
  const BATCH = 100;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < channels.length; i += BATCH) {
    const batch = channels.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (ch) => {
        if (!ch.email || !ch.smtpHost || !ch.smtpUser || !ch.smtpPass) {
          skipped++;
          return;
        }
        const { encrypted, iv, tag } = encrypt(ch.smtpPass);
        await prisma.smtpChannel.upsert({
          where: { workspaceId_email: { workspaceId: workspaceId!, email: ch.email } },
          update: {
            displayName: ch.displayName ?? null,
            smtpHost: ch.smtpHost,
            smtpPort: ch.smtpPort,
            smtpSecure: ch.smtpSecure,
            smtpUser: ch.smtpUser,
            smtpPassEncrypted: encrypted,
            smtpPassIv: iv,
            smtpPassTag: tag,
          },
          create: {
            workspaceId: workspaceId!,
            email: ch.email,
            displayName: ch.displayName ?? null,
            smtpHost: ch.smtpHost,
            smtpPort: ch.smtpPort,
            smtpSecure: ch.smtpSecure,
            smtpUser: ch.smtpUser,
            smtpPassEncrypted: encrypted,
            smtpPassIv: iv,
            smtpPassTag: tag,
          },
        });
        imported++;
      })
    );
  }

  return NextResponse.json({ imported, skipped });
}
