"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";

export default function LeadsRedirect() {
  const router = useRouter();
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();

  useEffect(() => {
    if (!workspaces) return;
    const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId) || workspaces[0];
    if (ws) router.replace(`/ws/${ws.slug}/leads`);
  }, [workspaces, activeWorkspaceId, router]);

  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      Redirecting...
    </div>
  );
}
