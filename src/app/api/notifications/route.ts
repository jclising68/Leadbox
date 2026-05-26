import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

type NotificationItem = {
  id: string;
  type: "reply" | "followUp";
  threadId: string;
  title: string;
  subtitle: string;
  at: string;
  isUnread: boolean;
};

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Only actual responses — inbound replies in the last 7 days — grouped by
  // thread (most recent message per thread wins so one thread doesn't flood
  // the list). Auto-tag events were removed: they fire on the same reply
  // that already notifies, so keeping them meant two notifications per
  // engagement.
  const replies = await prisma.message.findMany({
    where: {
      workspaceId: workspaceId!,
      direction: "INBOUND",
      receivedAt: { gte: since },
      thread: { status: { not: "TRASH" } },
    },
    distinct: ["threadId"],
    orderBy: { receivedAt: "desc" },
    take: 40,
    select: {
      id: true,
      threadId: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      sentAt: true,
      thread: {
        select: {
          id: true,
          isUnread: true,
          prospect: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });

  const items: NotificationItem[] = replies.map((r) => {
    const name =
      [r.thread.prospect.firstName, r.thread.prospect.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      r.thread.prospect.email ||
      "Unknown";
    const subtitle =
      (r.bodyText ?? r.subject ?? "").replace(/\s+/g, " ").slice(0, 120) ||
      "New reply";
    return {
      id: `reply:${r.id}`,
      type: "reply",
      threadId: r.threadId,
      title: `${name} replied`,
      subtitle,
      at: (r.receivedAt ?? r.sentAt ?? new Date()).toISOString(),
      isUnread: r.thread.isUnread,
    };
  });

  // Follow-up reminders: threads with a due followUpAt
  const dueFollowUps = await prisma.thread.findMany({
    where: {
      workspaceId: workspaceId!,
      followUpAt: { not: null, lte: new Date() },
      status: "OPEN",
    },
    select: {
      id: true,
      followUpAt: true,
      isUnread: true,
      prospect: {
        select: { firstName: true, lastName: true, email: true },
      },
    },
    orderBy: { followUpAt: "asc" },
    take: 20,
  });

  const followUpItems: NotificationItem[] = dueFollowUps.map((t) => {
    const name =
      [t.prospect.firstName, t.prospect.lastName].filter(Boolean).join(" ").trim() ||
      t.prospect.email ||
      "Unknown";
    return {
      id: `followup:${t.id}`,
      type: "followUp",
      threadId: t.id,
      title: `Follow-up due: ${name}`,
      subtitle: `Scheduled for ${new Date(t.followUpAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      at: t.followUpAt!.toISOString(),
      isUnread: t.isUnread,
    };
  });

  return workspaceJson({
    items: [...followUpItems, ...items],
    generatedAt: new Date().toISOString(),
  });
}
