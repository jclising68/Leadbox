import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

type NotificationItem =
  | {
      id: string;
      type: "reply";
      threadId: string;
      title: string;
      subtitle: string;
      at: string;
      isUnread: boolean;
    }
  | {
      id: string;
      type: "label";
      threadId: string;
      title: string;
      subtitle: string;
      at: string;
      labelColor: string;
      isUnread: boolean;
    };

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // New inbound replies in the last 7 days — grouped by thread (most recent
  // message per thread wins so one thread doesn't flood the list).
  const replies = await prisma.message.findMany({
    where: {
      workspaceId: workspaceId!,
      direction: "INBOUND",
      receivedAt: { gte: since },
      thread: { status: { not: "TRASH" } },
    },
    distinct: ["threadId"],
    orderBy: { receivedAt: "desc" },
    take: 30,
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

  // Recent label applications (auto AI + webhook-driven). Skip MANUAL —
  // the user themselves applied those, so no need to notify.
  const labelChanges = await prisma.threadLabel.findMany({
    where: {
      appliedAt: { gte: since },
      source: { in: ["AUTO_AI", "WEBHOOK"] },
      thread: { workspaceId: workspaceId!, status: { not: "TRASH" } },
    },
    orderBy: { appliedAt: "desc" },
    take: 30,
    select: {
      id: true,
      threadId: true,
      appliedAt: true,
      label: { select: { name: true, color: true } },
      thread: {
        select: {
          isUnread: true,
          prospect: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });

  const items: NotificationItem[] = [];

  for (const r of replies) {
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
    items.push({
      id: `reply:${r.id}`,
      type: "reply",
      threadId: r.threadId,
      title: `${name} replied`,
      subtitle,
      at: (r.receivedAt ?? r.sentAt ?? new Date()).toISOString(),
      isUnread: r.thread.isUnread,
    });
  }

  for (const lc of labelChanges) {
    const name =
      [lc.thread.prospect.firstName, lc.thread.prospect.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      lc.thread.prospect.email ||
      "Unknown";
    items.push({
      id: `label:${lc.id}`,
      type: "label",
      threadId: lc.threadId,
      title: `${name} tagged "${lc.label.name}"`,
      subtitle: "Auto-label applied",
      at: lc.appliedAt.toISOString(),
      labelColor: lc.label.color,
      isUnread: lc.thread.isUnread,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return workspaceJson({
    items: items.slice(0, 40),
    generatedAt: new Date().toISOString(),
  });
}
