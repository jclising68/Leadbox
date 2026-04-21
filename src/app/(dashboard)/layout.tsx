"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { AppSidebar } from "./components/app-sidebar";
import { AppHeader } from "./components/app-header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { data: workspaces, isLoading: loadingWorkspaces } = useWorkspaces();
  const { activeWorkspaceId, setActiveWorkspace } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Auto-create or select workspace
  useEffect(() => {
    if (!workspaces || loadingWorkspaces) return;

    if (workspaces.length === 0 && !creating) {
      setCreating(true);
      fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Workspace" }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("Failed to create workspace");
          return r.json();
        })
        .then((ws) => {
          setActiveWorkspace(ws.id);
          setCreating(false);
          router.replace(`/ws/${ws.slug}/inbox`);
        })
        .catch((err) => {
          console.error("[dashboard] Workspace creation failed:", err);
          setCreating(false);
        });
      return;
    }

    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspace(workspaces[0].id);
    }
  }, [workspaces, loadingWorkspaces, activeWorkspaceId, setActiveWorkspace, creating, router]);

  // Redirect bare paths (e.g. /inbox) to workspace-prefixed paths
  useEffect(() => {
    if (!workspaces || loadingWorkspaces || !activeWorkspaceId) return;

    const activeWs = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
    if (!activeWs) return;

    // If path doesn't start with /ws/, redirect to the workspace path
    if (!pathname.startsWith("/ws/")) {
      const newPath = `/ws/${activeWs.slug}${pathname}`;
      router.replace(newPath);
    }
  }, [pathname, workspaces, loadingWorkspaces, activeWorkspaceId, router]);

  if (status === "loading" || loadingWorkspaces || !activeWorkspaceId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="relative mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <span className="text-2xl font-bold text-primary">L</span>
          </div>
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: "1.5s" }}>
            <div className="w-2.5 h-2.5 rounded-full bg-primary absolute -top-1 left-1/2 -translate-x-1/2" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">LeadBox</h2>
        <p className="text-sm text-muted-foreground mb-6">Preparing your workspace...</p>
        <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-loading-bar" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
