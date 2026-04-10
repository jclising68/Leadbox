import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { threadId } = await params;

  const thread = await prisma.thread.findFirst({
    where: { id: threadId, workspaceId: workspaceId! },
    include: {
      prospect: true,
      threadLabels: { include: { label: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        include: { integration: { select: { name: true, provider: true } } },
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json(thread);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const body = await req.json();

  const allowedFields = ["status", "isUnread", "assignedTo"];
  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  const thread = await prisma.thread.updateMany({
    where: { id: threadId, workspaceId: workspaceId! },
    data,
  });

  if (thread.count === 0) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
