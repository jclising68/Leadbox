"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";

// Minimum time the loader stays visible. Without this, a fast network turns
// the loader into a 50ms flash and the workspace switch feels wrong.
const MIN_LOADER_MS = 450;

function createWorkspaceQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5000,
        gcTime: 300000,
        refetchOnWindowFocus: true,
      },
    },
  });
}

function WorkspaceLoading({ message }: { message: string }) {
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
      <p className="text-sm text-muted-foreground mb-6">{message}</p>
      <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full animate-loading-bar" />
      </div>
    </div>
  );
}

/**
 * Fetches threads + labels for `workspaceId` into `client`.
 * Uses `fetchQuery` / `fetchInfiniteQuery` so failures throw — we never lift
 * the loader on a half-loaded workspace.
 */
async function primeWorkspaceCache(client: QueryClient, workspaceId: string) {
  const headers = { "x-workspace-id": workspaceId };

  await Promise.all([
    // Default thread query — must mirror useThreads()'s queryKey exactly so
    // the children read directly from this cached entry on first render.
    client.fetchInfiniteQuery({
      queryKey: ["threads", workspaceId, "OPEN", null, "", null, false, null],
      queryFn: async () => {
        const params = new URLSearchParams();
        params.set("status", "OPEN");
        params.set("hasReply", "true");
        params.set("limit", "50");
        const res = await fetch(`/api/threads?${params}`, { headers, cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch threads");
        return res.json();
      },
      initialPageParam: undefined,
    }),
    client.fetchQuery({
      queryKey: ["labels", workspaceId],
      queryFn: async () => {
        const res = await fetch("/api/labels", { headers, cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch labels");
        return res.json();
      },
    }),
  ]);

  // Belt + suspenders: if anything else fired on this client (e.g. workspaces
  // refetch from focus), wait for it to settle before showing the inbox.
  while (client.isFetching() > 0) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Fire-and-forget: ask the server to pull fresh data from Instantly /
 * HeyReach for every active integration in this workspace. Rate-limited per
 * session so workspace navigation doesn't hammer provider APIs.
 */
function triggerBackgroundSync(workspaceId: string) {
  if (typeof window === "undefined") return;
  const key = `ws-sync-${workspaceId}`;
  const last = sessionStorage.getItem(key);
  if (last && Date.now() - Number(last) < 5 * 60 * 1000) return;
  sessionStorage.setItem(key, String(Date.now()));

  fetch("/api/integrations/sync-all", {
    method: "POST",
    headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
  }).catch(() => {
    // Non-critical; the periodic refetch will still pick up new data.
  });
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const { data: workspaces, isLoading } = useWorkspaces();
  const wsForSlug = workspaces?.find((w: { slug: string }) => w.slug === slug);

  // Per-workspace QueryClient — complete data-cache isolation between workspaces.
  const [currentSlug, setCurrentSlug] = useState("");
  const [wsClient, setWsClient] = useState(() => createWorkspaceQueryClient());
  const [primed, setPrimed] = useState(false);
  const primingRef = useRef<string | null>(null);

  // Detect slug change during render — fresh client + reset inbox state BEFORE
  // paint so the old workspace's selection never leaks into the new one.
  if (slug !== currentSlug) {
    setCurrentSlug(slug);
    setWsClient(createWorkspaceQueryClient());
    setPrimed(false);
    primingRef.current = null;

    const inbox = useInboxStore.getState();
    inbox.clearFilters();
    inbox.setSelectedThread(null);
    inbox.setSelectedLabel(null);
    inbox.setView("OPEN");
  }

  // Keep Zustand store in sync with URL (sidebar UI only).
  useEffect(() => {
    if (wsForSlug && wsForSlug.id !== useWorkspaceStore.getState().activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(wsForSlug.id);
    }
  }, [wsForSlug]);

  // Prime the workspace cache. Hold `primed` false until BOTH (a) prefetch
  // resolves and (b) the minimum loader window has elapsed.
  useEffect(() => {
    if (!wsForSlug?.id) return;
    if (primingRef.current === wsForSlug.id) return;
    primingRef.current = wsForSlug.id;

    const startedAt = performance.now();

    primeWorkspaceCache(wsClient, wsForSlug.id)
      .catch((err) => {
        console.error("[workspace] prime failed:", err);
      })
      .then(async () => {
        const elapsed = performance.now() - startedAt;
        const remaining = MIN_LOADER_MS - elapsed;
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, remaining));
        }
        // Race guard: only flip `primed` if we're still on the same workspace.
        if (primingRef.current === wsForSlug.id) {
          setPrimed(true);
        }
      });

    // Pull fresh data from Instantly / HeyReach in the background.
    triggerBackgroundSync(wsForSlug.id);
  }, [wsForSlug?.id, wsClient]);

  // Redirect if workspace not found
  if (!isLoading && workspaces && !wsForSlug) {
    if (workspaces.length > 0) {
      router.replace(`/ws/${workspaces[0].slug}/inbox`);
    }
    return null;
  }

  // Hold the unified loader until the workspace's actual inbox data is ready.
  if (isLoading || !wsForSlug || !primed) {
    return <WorkspaceLoading message="Loading workspace data..." />;
  }

  // `key={slug}` forces a clean remount of the entire children tree on
  // workspace switch — no stale component state, no stale context, no leaked
  // selections from the previous workspace.
  return (
    <QueryClientProvider client={wsClient}>
      <div key={slug} className="h-full">
        {children}
      </div>
    </QueryClientProvider>
  );
}
