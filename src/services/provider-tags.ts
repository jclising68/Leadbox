import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export type ProviderSyncResult =
  | { ok: true; provider: "INSTANTLY" | "HEYREACH"; tagCount: number }
  | { ok: false; provider: "INSTANTLY" | "HEYREACH" | "NONE"; error: string };

/**
 * Push the *full* current label set for a thread to the upstream provider
 * (Instantly or HeyReach). Idempotent: this is the source of truth for the
 * thread's tags on the provider side, so adds and removes both reduce to
 * "send the current list".
 *
 * Returns a structured result so the API route can include it in its response
 * and the frontend can show a toast like "tag applied; HeyReach push failed".
 */
export async function syncProviderTags(
  workspaceId: string,
  threadId: string
): Promise<ProviderSyncResult> {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    select: {
      channel: true,
      prospect: { select: { email: true, linkedinUrl: true } },
      threadLabels: { include: { label: { select: { name: true } } } },
    },
  });
  if (!thread) return { ok: false, provider: "NONE", error: "thread not found" };

  const tags = Array.from(
    new Set(thread.threadLabels.map((tl) => tl.label.name).filter(Boolean))
  );

  const provider = thread.channel === "EMAIL" ? "INSTANTLY" : "HEYREACH";
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, provider, isActive: true },
  });
  if (!integration) {
    const msg = `no active ${provider} integration for this workspace`;
    console.warn(`[provider-tags] ${msg}`);
    return { ok: false, provider, error: msg };
  }

  const apiKey = decrypt(
    integration.apiKeyEncrypted,
    integration.apiKeyIv,
    integration.apiKeyTag
  );

  try {
    if (provider === "INSTANTLY") {
      if (!thread.prospect.email) {
        const msg = "thread has no prospect email";
        console.warn(`[provider-tags] ${msg}`);
        return { ok: false, provider, error: msg };
      }
      await pushInstantlyTags(apiKey, thread.prospect.email, tags);
      console.log(`[provider-tags] ✓ pushed ${tags.length} tag(s) to Instantly for ${thread.prospect.email}`);
    } else {
      if (!thread.prospect.linkedinUrl) {
        const msg = "thread has no prospect LinkedIn URL";
        console.warn(`[provider-tags] ${msg}`);
        return { ok: false, provider, error: msg };
      }
      await pushHeyreachTags(apiKey, thread.prospect.linkedinUrl, tags);
      console.log(`[provider-tags] ✓ pushed ${tags.length} tag(s) to HeyReach for ${thread.prospect.linkedinUrl}`);
    }
    return { ok: true, provider, tagCount: tags.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[provider-tags] ✗ failed to push to ${provider}:`, message);
    return { ok: false, provider, error: message };
  }
}

// ────────────────────────── HeyReach ──────────────────────────

/**
 * HeyReach requires URLs in the canonical `https://www.linkedin.com/in/{slug}/`
 * shape. Sync stores whatever HeyReach itself returned, but if a URL came in
 * via a webhook or another route it might be `linkedin.com/in/foo` — fix it.
 */
function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    // Force www subdomain (regional like `xx.linkedin.com` would be rejected).
    u.host = "www.linkedin.com";
    u.protocol = "https:";
    u.search = "";
    u.hash = "";
    let path = u.pathname;
    if (!path.endsWith("/")) path += "/";
    return `https://www.linkedin.com${path}`;
  } catch {
    return url;
  }
}

async function pushHeyreachTags(apiKey: string, profileUrl: string, tags: string[]) {
  const normalizedUrl = normalizeLinkedinUrl(profileUrl);
  const body = {
    leadProfileUrl: normalizedUrl,
    tags,
    createTagIfNotExisting: true,
  };
  console.log("[provider-tags] HeyReach ReplaceTags request body:", JSON.stringify(body));
  const res = await fetch("https://api.heyreach.io/api/public/lead/ReplaceTags", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach ReplaceTags ${res.status}: ${text}`);
  }
}

// ────────────────────────── Instantly ──────────────────────────

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type InstantlyTag = { id: string; label: string };
type InstantlyLead = { id: string; email: string; custom_tag_ids?: string[] };

async function instantlyFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  // Read once as text — some 2xx Instantly endpoints (e.g. toggle-resource)
  // return an empty body, which would blow up res.json() with
  // "Unexpected end of JSON input" and falsely look like a failure.
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Instantly ${path} ${res.status}: ${text}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Instantly's tag model: tags are first-class resources (`/custom-tags`) that
 * are toggled on leads via `/custom-tags/toggle-resource`. We can't just send
 * a string list like with HeyReach — we need real IDs. Flow:
 *   1. Look up the lead by email → get lead UUID + currently-assigned tag IDs.
 *   2. Ensure every desired label exists as a custom-tag (create if missing).
 *   3. Diff current vs desired tag IDs → call toggle-resource with add/remove.
 */
async function pushInstantlyTags(apiKey: string, email: string, desired: string[]) {
  // 1. Find the lead by email.
  const leadList = await instantlyFetch(apiKey, "/leads/list", {
    method: "POST",
    body: JSON.stringify({ search: email, limit: 1 }),
  });
  const lead = (leadList.items as InstantlyLead[] | undefined)?.[0];
  if (!lead) {
    throw new Error(`lead not found in Instantly for email ${email}`);
  }
  // IMPORTANT: Instantly's /leads/list does NOT return custom_tag_ids on the
  // lead object (verified by direct API probe). That makes it impossible to
  // know the lead's current tag set from this endpoint, so we cannot safely
  // diff-and-delete — a deletion pass here would strip every Instantly tag
  // off the lead. Treat this push as ADDITIVE-ONLY: we assign the desired
  // tags and never remove anything. Removing a label in Leadbox will
  // therefore keep the tag on the Instantly side (by design, safer than
  // wiping user data). If Instantly later exposes a per-lead tag endpoint
  // we can re-introduce the remove path.

  // 2. Resolve desired label names to tag IDs, creating any that are missing.
  const tagsList = await instantlyFetch(apiKey, "/custom-tags?limit=100", {
    method: "GET",
  });
  const existing = (tagsList.items as InstantlyTag[] | undefined) ?? [];
  const tagIdByName = new Map<string, string>(
    existing.map((t) => [t.label, t.id])
  );
  const desiredIds = new Set<string>();
  for (const name of desired) {
    let id = tagIdByName.get(name);
    if (!id) {
      const created = (await instantlyFetch(apiKey, "/custom-tags", {
        method: "POST",
        body: JSON.stringify({ label: name }),
      })) as InstantlyTag;
      id = created.id;
      tagIdByName.set(name, id);
    }
    desiredIds.add(id);
  }

  // 3. Additive apply — assign all desired tags. Instantly's toggle-resource
  // with assign:true is idempotent for already-assigned tags, so re-sending
  // the full desired set is safe.
  if (desiredIds.size) {
    await instantlyFetch(apiKey, "/custom-tags/toggle-resource", {
      method: "POST",
      body: JSON.stringify({
        tag_ids: [...desiredIds],
        resource_ids: [lead.id],
        resource_type: 1, // 1 = lead
        assign: true,
      }),
    });
  }
}
