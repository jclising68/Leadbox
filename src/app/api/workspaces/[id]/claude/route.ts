import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { encrypt } from "@/lib/crypto";

export async function POST(
  req: NextRequest
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { apiKey } = await req.json();

  if (!apiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  const { encrypted, iv, tag } = encrypt(apiKey);

  await prisma.workspace.update({
    where: { id: workspaceId! },
    data: {
      claudeKey: encrypted,
      claudeKeyIv: iv,
      claudeKeyTag: tag,
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  await prisma.workspace.update({
    where: { id: workspaceId! },
    data: { claudeKey: null, claudeKeyIv: null, claudeKeyTag: null },
  });

  return NextResponse.json({ success: true });
}
