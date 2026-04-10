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
  const { setActiveWorkspace, activeWorkspaceId, setSwitching } = useWorkspaceStore();
  const prevSlugRef = useRef(slug);

  useEffect(() => {
    if (!workspaces || isLoading) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);
    if (ws) {
      const slugChanged = prevSlugRef.current !== slug;
      prevSlugRef.current = slug;

      if (ws.id !== activeWorkspaceId) {
        setActiveWorkspace(ws.id);
      }

      if (slugChanged) {
        // Reset filters and selection when switching workspaces
        useInboxStore.getState().clearFilters();
        useInboxStore.getState().setSelectedThread(null);
        useInboxStore.getState().setSelectedLabel(null);
        useInboxStore.getState().setView("OPEN");
        // Keep loading overlay visible while data refetches
        const t = setTimeout(() => setSwitching(false), 600);
        return () => clearTimeout(t);
      } else {
        setSwitching(false);
      }
    } else if (workspaces.length > 0) {
      router.replace(`/ws/${workspaces[0].slug}/inbox`);
    }
  }, [slug, workspaces, isLoading, activeWorkspaceId, setActiveWorkspace, setSwitching, router]);

  if (isLoading) {
    return null; // Parent dashboard layout handles the loading state
  }

  return <>{children}</>;
}
