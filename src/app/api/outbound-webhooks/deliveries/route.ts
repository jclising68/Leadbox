import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const url = req.nextUrl.searchParams.get("url") ?? undefined;

  const deliveries = await prisma.outboundWebhookDelivery.findMany({
    where: {
      workspaceId: workspaceId!,
      ...(url ? { webhookUrl: url } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      webhookUrl: true,
      event: true,
      statusCode: true,
      success: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json(deliveries);
}
