import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const labels = await prisma.label.findMany({
    where: { workspaceId: workspaceId! },
    include: {
      _count: {
        select: {
          threadLabels: {
            where: {
              thread: { status: "OPEN", isUnread: true },
            },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(labels);
}

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { name, color, icon } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const label = await prisma.label.create({
    data: {
      workspaceId: workspaceId!,
      name,
      color: color || "#6B7280",
      icon,
    },
  });

  return NextResponse.json(label, { status: 201 });
}
