import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const hooks = await prisma.outboundWebhook.findMany({
    where: { workspaceId: workspaceId! },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(hooks);
}

export async function POST(req: NextRequest) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { label, url, triggers, tagFilters } = (await req.json()) as {
    label?: string; url?: string; triggers?: string[]; tagFilters?: string[];
  };

  if (!label?.trim() || !url?.trim()) {
    return NextResponse.json({ error: "label and url are required" }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const validTriggers = ["reply_received", "lead_tagged"];
  const cleanTriggers = (triggers ?? []).filter((t) => validTriggers.includes(t));

  const hook = await prisma.outboundWebhook.create({
    data: {
      workspaceId: workspaceId!,
      label: label.trim(),
      url: url.trim(),
      triggers: cleanTriggers,
      tagFilters: tagFilters ?? [],
    },
  });

  return NextResponse.json(hook, { status: 201 });
}
