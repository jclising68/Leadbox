"use client";

import { useEffect } from "react";
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
  const { setActiveWorkspace, activeWorkspaceId } = useWorkspaceStore();

  useEffect(() => {
    if (!workspaces || isLoading) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);
    if (ws) {
      if (ws.id !== activeWorkspaceId) {
        setActiveWorkspace(ws.id);
        // Reset filters and selection when switching workspaces
        useInboxStore.getState().clearFilters();
        useInboxStore.getState().setSelectedThread(null);
        useInboxStore.getState().setSelectedLabel(null);
        useInboxStore.getState().setView("OPEN");
      }
    } else if (workspaces.length > 0) {
      // Invalid slug — redirect to first workspace
      router.replace(`/ws/${workspaces[0].slug}/inbox`);
    }
  }, [slug, workspaces, isLoading, activeWorkspaceId, setActiveWorkspace, router]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading workspace...</div>
      </div>
    );
  }

  return <>{children}</>;
}
