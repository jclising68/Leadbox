"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";

const MIN_LOADING_MS = 600;

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

  const [loading, setLoading] = useState(true);
  const [prevSlug, setPrevSlug] = useState("");
  const loadStartRef = useRef(Date.now());

  // === RENDER-PHASE: Detect slug change and reset state BEFORE paint ===
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setLoading(true);
    loadStartRef.current = Date.now();

    // Synchronously reset inbox state so children never see stale filters
    const inbox = useInboxStore.getState();
    inbox.clearFilters();
    inbox.setSelectedThread(null);
    inbox.setSelectedLabel(null);
    inbox.setView("OPEN");
  }

  // === EFFECT-PHASE: Sync store, clear cache, then allow render ===
  useEffect(() => {
    if (!workspaces || isLoading || !loading) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);

    if (!ws) {
      if (workspaces.length > 0) {
        router.replace(`/ws/${workspaces[0].slug}/inbox`);
      }
      return;
    }

    // Sync workspace store with URL
    if (ws.id !== activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    }

    // Clear ONLY workspace-scoped queries (keep "workspaces" list intact)
    queryClient.removeQueries({ queryKey: ["threads"] });
    queryClient.removeQueries({ queryKey: ["thread"] });
    queryClient.removeQueries({ queryKey: ["prospects"] });
    queryClient.removeQueries({ queryKey: ["labels"] });

    // Ensure loading page is visible for minimum time
    const elapsed = Date.now() - loadStartRef.current;
    const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
    setTimeout(() => setLoading(false), remaining);
  }, [slug, workspaces, isLoading, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // === LOADING PAGE ===
  if (loading) {
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

  // key={slug} forces ALL children to unmount/remount with fresh hooks
  return <div key={slug} className="h-full">{children}</div>;
}
