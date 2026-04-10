"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { data: workspaces, isLoading } = useWorkspaces();
  const { activeWorkspaceId, setSwitching } = useWorkspaceStore();
  const prevSlugRef = useRef(slug);

  // Only react to slug changes — the sidebar already sets activeWorkspaceId
  useEffect(() => {
    if (!workspaces || isLoading) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);

    if (!ws) {
      if (workspaces.length > 0) {
        router.replace(`/ws/${workspaces[0].slug}/inbox`);
      }
      return;
    }

    const slugChanged = prevSlugRef.current !== slug;
    prevSlugRef.current = slug;

    if (slugChanged) {
      // Sync store if needed (e.g. direct URL navigation)
      if (ws.id !== activeWorkspaceId) {
        useWorkspaceStore.getState().setActiveWorkspace(ws.id);
      }
      // Reset filters and selection for new workspace
      useInboxStore.getState().clearFilters();
      useInboxStore.getState().setSelectedThread(null);
      useInboxStore.getState().setSelectedLabel(null);
      useInboxStore.getState().setView("OPEN");
      // Keep loading overlay visible while data refetches
      const t = setTimeout(() => setSwitching(false), 800);
      return () => clearTimeout(t);
    }

    // Initial mount — sync store with URL slug
    if (ws.id !== activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
      // Don't set switching on initial load — dashboard layout handles that
      setSwitching(false);
    }
  }, [slug, workspaces, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return null;
  }

  return <>{children}</>;
}
