import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

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
        take: 200,
        include: { integration: { select: { name: true, provider: true } } },
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return workspaceJson(thread);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const { threadId } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};

  // Validate status enum
  if (body.status !== undefined) {
    const validStatuses = ["OPEN", "ARCHIVED", "SPAM", "TRASH"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }
    data.status = body.status;
  }

  // Validate isUnread is boolean
  if (body.isUnread !== undefined) {
    if (typeof body.isUnread !== "boolean") {
      return NextResponse.json({ error: "isUnread must be a boolean" }, { status: 400 });
    }
    data.isUnread = body.isUnread;
  }

  // assignedTo is a string or null
  if (body.assignedTo !== undefined) {
    data.assignedTo = body.assignedTo;
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
