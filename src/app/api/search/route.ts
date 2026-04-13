import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { workspaceJson } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req);
  if (error) return error;

  const query = req.nextUrl.searchParams.get("q");
  if (!query || query.length < 2) {
    return workspaceJson({ threads: [] });
  }

  const threads = await prisma.thread.findMany({
    where: {
      workspaceId: workspaceId!,
      OR: [
        { snippet: { contains: query, mode: "insensitive" } },
        {
          prospect: {
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { company: { contains: query, mode: "insensitive" } },
            ],
          },
        },
        {
          messages: {
            some: {
              OR: [
                { subject: { contains: query, mode: "insensitive" } },
                { bodyText: { contains: query, mode: "insensitive" } },
                { messageText: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    },
    include: {
      prospect: true,
      threadLabels: { include: { label: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
  });

  return workspaceJson({ threads });
}
