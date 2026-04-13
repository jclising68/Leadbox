import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { workspaceJson } from "@/lib/api-response";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id as string },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      linkedinUrl: true,
      memberships: {
        include: {
          workspace: { select: { id: true, name: true } },
        },
        take: 1,
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return workspaceJson({
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatarUrl,
    linkedinUrl: dbUser.linkedinUrl,
    companyName: dbUser.memberships[0]?.workspace?.name ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, avatarUrl, linkedinUrl } = body;

  const updated = await prisma.user.update({
    where: { id: session.user.id as string },
    data: {
      ...(name !== undefined && { name }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      linkedinUrl: true,
    },
  });

  return NextResponse.json(updated);
}
