"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const { data: workspaces, isLoading } = useWorkspaces();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [ready, setReady] = useState(false);
  const [prevSlug, setPrevSlug] = useState("");

  // Detect slug change during render — reset immediately before paint
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setReady(false);

    // Synchronously reset inbox state so children never see stale filters
    const inbox = useInboxStore.getState();
    inbox.clearFilters();
    inbox.setSelectedThread(null);
    inbox.setSelectedLabel(null);
    inbox.setView("OPEN");
  }

  // Sync store, clear stale cache, PREFETCH data, then render children
  useEffect(() => {
    if (!workspaces || isLoading || ready) return;

    const ws = workspaces.find((w: { slug: string }) => w.slug === slug);

    if (!ws) {
      if (workspaces.length > 0) router.replace(`/ws/${workspaces[0].slug}/inbox`);
      return;
    }

    // Sync workspace store with URL
    if (ws.id !== activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(ws.id);
    }

    // Remove stale workspace-scoped cache (keep "workspaces" list intact)
    queryClient.removeQueries({ queryKey: ["threads"] });
    queryClient.removeQueries({ queryKey: ["thread"] });
    queryClient.removeQueries({ queryKey: ["prospects"] });
    queryClient.removeQueries({ queryKey: ["labels"] });

    // Prefetch threads + labels so children find warm cache on mount.
    // Query keys must match what useThreads() and useLabels() will use
    // after inbox state reset: view="OPEN", no filters, no search.
    const headers = { "x-workspace-id": ws.id, "Content-Type": "application/json" };

    Promise.all([
      fetch(`/api/threads?status=OPEN&hasReply=true&limit=50`, { headers })
        .then((r) => r.json())
        .then((data) => {
          // Store in cache with the exact key useThreads() will look up
          queryClient.setQueryData(
            ["threads", ws.id, "OPEN", null, "", null, false, null],
            { pages: [data], pageParams: [undefined] }
          );
        }),
      fetch(`/api/labels`, { headers })
        .then((r) => r.json())
        .then((data) => {
          queryClient.setQueryData(["labels", ws.id], data);
        }),
    ])
      .then(() => setReady(true))
      .catch(() => setReady(true)); // Render children even if prefetch fails
  }, [slug, workspaces, isLoading, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading page — blocks until data is prefetched
  if (isLoading || !ready) {
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

  // key={slug} forces full remount. Children find warm cache from prefetch.
  return <div key={slug} className="h-full">{children}</div>;
}
