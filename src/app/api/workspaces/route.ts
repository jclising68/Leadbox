import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth-helpers";
import { DEFAULT_LABELS } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: user.id } } },
    include: {
      members: {
        where: { userId: user.id },
        select: { role: true },
      },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(workspaces);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug,
      members: {
        create: { userId: user.id!, role: "OWNER" },
      },
      labels: {
        createMany: {
          data: DEFAULT_LABELS.map((l) => ({
            name: l.name,
            color: l.color,
            isSystem: l.isSystem,
            sortOrder: l.sortOrder,
          })),
        },
      },
    },
    include: {
      members: { select: { role: true, userId: true } },
    },
  });

  return NextResponse.json(workspace, { status: 201 });
}
