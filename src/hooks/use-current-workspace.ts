"use client";

import { useParams } from "next/navigation";
import { useWorkspaces } from "./use-workspace";

/**
 * Returns the active workspace derived from the URL slug.
 * This is the SINGLE SOURCE OF TRUTH for workspace context in data-fetching hooks.
 * URL changes are immediate and atomic — no timing issues, no state sync races.
 */
export function useCurrentWorkspace() {
  const params = useParams();
  const slug = (params?.slug as string | undefined) ?? "";
  const { data: workspaces } = useWorkspaces();
  return workspaces?.find((w: { slug: string }) => w.slug === slug) ?? null;
}

/**
 * Returns the active workspace ID from the URL. Returns null if not yet resolved.
 */
export function useCurrentWorkspaceId(): string | null {
  const ws = useCurrentWorkspace();
  return ws?.id ?? null;
}
