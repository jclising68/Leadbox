import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, error } = await requireWorkspaceAccess(req);
  if (error) return error;

  const { id } = await params;

  const hook = await prisma.outboundWebhook.findUnique({ where: { id } });
  if (!hook || hook.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "test",
        email: "test@example.com",
        firstName: "Test",
        lastName: "Lead",
        company: "Acme Corp",
        domain: "acme.com",
        phone: "+1234567890",
        title: "Founder & CEO",
        linkedinUrl: "https://linkedin.com/in/testlead",
        source: "Email",
        campaignName: "Test Campaign",
        stepReplied: "Step 1",
        label: "Interested",
        notes: "Sample note from test",
        feedback: null,
        timestamp: new Date().toISOString(),
      }),
    });
    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Request failed" },
      { status: 502 }
    );
  }
}
