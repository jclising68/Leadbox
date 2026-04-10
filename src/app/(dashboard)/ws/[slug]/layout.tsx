"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";
import { Loader2 } from "lucide-react";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const queryClient = useQueryClient();
  const { data: workspaces, isLoading } = useWorkspaces();
  const { activeWorkspaceId, setSwitching } = useWorkspaceStore();
  const prevSlugRef = useRef(slug);
  const [dataReady, setDataReady] = useState(false);

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
      // Block rendering until new data loads
      setDataReady(false);

      // Sync store if needed
      if (ws.id !== activeWorkspaceId) {
        useWorkspaceStore.getState().setActiveWorkspace(ws.id);
      }

      // Reset filters and selection for new workspace
      useInboxStore.getState().clearFilters();
      useInboxStore.getState().setSelectedThread(null);
      useInboxStore.getState().setSelectedLabel(null);
      useInboxStore.getState().setView("OPEN");

      // Remove all cached data so old workspace data doesn't flash
      queryClient.removeQueries({ queryKey: ["threads"] });
      queryClient.removeQueries({ queryKey: ["thread"] });
      queryClient.removeQueries({ queryKey: ["prospects"] });
      queryClient.removeQueries({ queryKey: ["labels"] });

      // Wait for fresh data to load before showing the page
      Promise.all([
        queryClient.refetchQueries({ queryKey: ["threads"] }),
        queryClient.refetchQueries({ queryKey: ["labels"] }),
      ]).then(() => {
        setDataReady(true);
        setSwitching(false);
      }).catch(() => {
        // Still clear loading even if refetch fails
        setDataReady(true);
        setSwitching(false);
      });
    } else {
      // Initial mount or same workspace
      if (ws.id !== activeWorkspaceId) {
        useWorkspaceStore.getState().setActiveWorkspace(ws.id);
      }
      setDataReady(true);
      setSwitching(false);
    }
  }, [slug, workspaces, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show loading until workspace data is actually ready
  if (isLoading || !dataReady) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background">
        <div className="relative mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <span className="text-2xl font-bold text-primary">L</span>
          </div>
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: "1.5s" }}>
            <div className="w-2.5 h-2.5 rounded-full bg-primary absolute -top-1 left-1/2 -translate-x-1/2" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">LeadBox</h2>
        <p className="text-sm text-muted-foreground mb-6">Loading workspace data...</p>
        <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-loading-bar" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
