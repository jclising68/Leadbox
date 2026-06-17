import { prisma } from "@/lib/prisma";

export type ActivityType =
  | "label_applied"
  | "label_removed"
  | "follow_up_scheduled"
  | "follow_up_cleared"
  | "reply_sent"
  | "pipeline_added"
  | "pipeline_moved"
  | "pipeline_removed";

export function logActivity(
  workspaceId: string,
  threadId: string | null,
  prospectId: string | null,
  type: ActivityType,
  metadata: Record<string, string | null> = {}
): void {
  // Fire-and-forget, never throws
  prisma.leadActivity
    .create({ data: { workspaceId, threadId, prospectId, type, metadata } })
    .catch((err) =>
      console.error(
        "[lead-activity] log failed:",
        err instanceof Error ? err.message : err
      )
    );
}
