"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";

const MIN_LOADING_MS = 500;

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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const fetchCount = useIsFetching();

  const [overlay, setOverlay] = useState(true);
  const [prevSlug, setPrevSlug] = useState("");
  const [storeReady, setStoreReady] = useState(false);
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [fetchStarted, setFetchStarted] = useState(false);

  // === RENDER-PHASE: Detect slug change, reset state before paint ===
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setOverlay(true);
    setStoreReady(false);
    setMinTimePassed(false);
    setFetchStarted(false);

    // Synchronously reset inbox state
    const inbox = useInboxStore.getState();
    inbox.clearFilters();
    inbox.setSelectedThread(null);
    inbox.setSelectedLabel(null);
    inbox.setView("OPEN");
  }

  // === EFFECT: Sync store + clear stale cache ===
  useEffect(() => {
    if (!workspaces || isLoading || storeReady) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);
    if (!ws) {
      if (workspaces.length > 0) router.replace(`/ws/${workspaces[0].slug}/inbox`);
      return;
    }

    // Sync workspace store
    if (ws.id !== activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    }

    // Clear workspace-scoped cache (keep workspaces list)
    queryClient.removeQueries({ queryKey: ["threads"] });
    queryClient.removeQueries({ queryKey: ["thread"] });
    queryClient.removeQueries({ queryKey: ["prospects"] });
    queryClient.removeQueries({ queryKey: ["labels"] });

    setStoreReady(true);
  }, [slug, workspaces, isLoading, storeReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // === EFFECT: Minimum display time ===
  useEffect(() => {
    if (!overlay) return;
    const t = setTimeout(() => setMinTimePassed(true), MIN_LOADING_MS);
    return () => clearTimeout(t);
  }, [overlay]);

  // === EFFECT: Track when children hooks start fetching ===
  useEffect(() => {
    if (storeReady && fetchCount > 0) {
      setFetchStarted(true);
    }
  }, [storeReady, fetchCount]);

  // === EFFECT: Dismiss overlay when data is loaded + min time passed ===
  useEffect(() => {
    if (minTimePassed && fetchStarted && fetchCount === 0) {
      setOverlay(false);
    }
  }, [minTimePassed, fetchStarted, fetchCount]);

  // Workspace not found in list yet
  if (isLoading || !workspaces) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-background">
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

  return (
    <div className="h-full relative">
      {/* Loading overlay — sits on top of children, hides them until data is ready */}
      {overlay && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background">
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
      )}

      {/* Children render behind overlay so their hooks start fetching */}
      {storeReady && <div key={slug} className="h-full">{children}</div>}
    </div>
  );
}
