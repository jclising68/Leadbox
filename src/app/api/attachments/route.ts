import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccess } from "@/lib/auth-helpers";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BUCKET = "attachments";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(req: NextRequest) {
  const { error, workspaceId } = await requireWorkspaceAccess(req, "MEMBER");
  if (error) return error;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const threadId = formData.get("threadId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${workspaceId}/${threadId ?? "general"}/${Date.now()}-${safeName}`;

  // Try Supabase Storage first; fall back to local filesystem for dev
  const supabase = createSupabaseAdmin();
  if (supabase) {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[attachments] Supabase upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({ url: data.publicUrl, name: file.name, size: file.size, type: file.type });
  }

  // Local dev fallback — write to public/uploads/ and serve via Next.js static
  const localDir = join(process.cwd(), "public", "uploads", workspaceId!, threadId ?? "general");
  await mkdir(localDir, { recursive: true });
  const fileName = `${Date.now()}-${safeName}`;
  await writeFile(join(localDir, fileName), Buffer.from(bytes));
  const url = `/uploads/${workspaceId}/${threadId ?? "general"}/${fileName}`;

  return NextResponse.json({ url, name: file.name, size: file.size, type: file.type });
}
