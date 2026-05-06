import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { randomBytes, createHash } from "crypto";

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString("hex");
  const raw = `lb_${secret}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 10); // "lb_" + first 7 chars of secret
  return { raw, hash, prefix };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { id: paramId } = await params;
  if (paramId !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const keys = await prisma.workspaceApiKey.findMany({
    where: { workspaceId: workspaceId!, revokedAt: null },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ keys });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id: paramId } = await params;
  if (paramId !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const name = (body.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { raw, hash, prefix } = generateApiKey();

  await prisma.workspaceApiKey.create({
    data: { workspaceId: workspaceId!, name, keyHash: hash, keyPrefix: prefix },
  });

  // Return the raw key only once — it cannot be retrieved again
  return NextResponse.json({ key: raw, prefix, name }, { status: 201 });
}
