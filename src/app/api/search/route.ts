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

  // Search on prospect fields and thread snippet only.
  // Message body search (bodyText/messageText) was removed because
  // ILIKE '%term%' on large text columns causes sequential scans at scale.
  // TODO: Add pg_trgm GIN indexes or Supabase FTS for message body search.
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
      ],
    },
    include: {
      prospect: {
        select: {
          id: true, email: true, firstName: true, lastName: true,
          company: true, domain: true, linkedinUrl: true,
        },
      },
      threadLabels: { include: { label: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
  });

  return workspaceJson({ threads });
}
