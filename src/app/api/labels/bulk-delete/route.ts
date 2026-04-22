import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

// Bulk-delete labels by id. Refuses to delete system labels (seeded at
// workspace creation — see lib/constants.ts DEFAULT_LABELS). Cascades to
// ThreadLabel rows via Prisma relational cascade.
export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const body = (await req.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No label ids provided" }, { status: 400 });
  }

  // Scope strictly to this workspace and non-system labels. Any id that
  // doesn't match (cross-workspace or system) is silently filtered — the
  // caller gets a count of what actually got deleted.
  const deletable = await prisma.label.findMany({
    where: {
      id: { in: ids },
      workspaceId: workspaceId!,
      isSystem: false,
    },
    select: { id: true },
  });

  if (deletable.length === 0) {
    return NextResponse.json({
      deleted: 0,
      skipped: ids.length,
      reason: "none_eligible",
    });
  }

  const deletableIds = deletable.map((l) => l.id);

  // One transaction — drop ThreadLabel assignments then the labels themselves.
  // Prisma's onDelete cascade would handle this automatically if the relation
  // is configured that way, but explicit deletion is safe regardless.
  await prisma.$transaction([
    prisma.threadLabel.deleteMany({ where: { labelId: { in: deletableIds } } }),
    prisma.label.deleteMany({ where: { id: { in: deletableIds } } }),
  ]);

  return NextResponse.json({
    deleted: deletableIds.length,
    skipped: ids.length - deletableIds.length,
  });
}
