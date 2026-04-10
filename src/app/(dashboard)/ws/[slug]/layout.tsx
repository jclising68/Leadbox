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
  const { activeWorkspaceId } = useWorkspaceStore();

  const [loading, setLoading] = useState(true);
  const [prevSlug, setPrevSlug] = useState("");
  const loadStartRef = useRef(Date.now());

  // Detect slug change during render — block content immediately
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setLoading(true);
    loadStartRef.current = Date.now();
  }

  useEffect(() => {
    if (!workspaces || isLoading || !loading) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);

    if (!ws) {
      if (workspaces.length > 0) {
        router.replace(`/ws/${workspaces[0].slug}/inbox`);
      }
      return;
    }

    // Sync store with this workspace
    if (ws.id !== activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    }

    // Reset inbox state
    useInboxStore.getState().clearFilters();
    useInboxStore.getState().setSelectedThread(null);
    useInboxStore.getState().setSelectedLabel(null);
    useInboxStore.getState().setView("OPEN");

    // Wipe ALL cached query data — fresh start for new workspace
    queryClient.clear();

    // Ensure loading page visible for minimum time
    const elapsed = Date.now() - loadStartRef.current;
    const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

    setTimeout(() => setLoading(false), remaining);
  }, [slug, workspaces, isLoading, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // key={slug} forces full remount of ALL children when workspace changes
  // This guarantees every hook starts fresh with zero cached data
  return <div key={slug} className="h-full">{children}</div>;
}
