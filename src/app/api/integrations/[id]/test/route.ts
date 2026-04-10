import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { decrypt } from "@/lib/crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "ADMIN");
  if (error) return error;

  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, workspaceId: workspaceId! },
  });

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  try {
    if (integration.provider === "INSTANTLY") {
      const res = await fetch(
        "https://api.instantly.ai/api/v2/campaigns?limit=1",
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: `Instantly API returned ${res.status}` },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true, provider: "INSTANTLY" });
    }

    if (integration.provider === "HEYREACH") {
      const res = await fetch(
        "https://api.heyreach.io/api/v1/campaign/GetAll?page=0&size=1",
        {
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
        }
      );
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: `HeyReach API returned ${res.status}` },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true, provider: "HEYREACH" });
    }

    return NextResponse.json(
      { error: "Unknown provider" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      },
      { status: 500 }
    );
  }
}
