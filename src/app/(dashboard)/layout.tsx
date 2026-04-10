"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { AppSidebar } from "./components/app-sidebar";

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
        .then((r) => r.json())
        .then((ws) => {
          setActiveWorkspace(ws.id);
          setCreating(false);
          router.replace(`/ws/${ws.slug}/inbox`);
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
