import { NextResponse } from "next/server";

/**
 * JSON response for endpoints whose body depends on the caller's workspace
 * (the `x-workspace-id` header) or the authenticated user.
 *
 * Why this exists: the browser HTTP cache is keyed by URL only — NOT by
 * request headers. A response with `Cache-Control: max-age=...` will be
 * served from disk on a subsequent request to the same URL even if the
 * `x-workspace-id` header changed. That's how we leaked threads from one
 * workspace into another. Use this helper for every workspace- or user-
 * scoped GET so the bug can't reappear.
 */
export function workspaceJson<T>(data: T, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Vary", "x-workspace-id");
  return res;
}
