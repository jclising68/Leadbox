"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  const { data: workspaces, isLoading } = useWorkspaces();
  const { setActiveWorkspace, activeWorkspaceId, switching, setSwitching } = useWorkspaceStore();
  const [ready, setReady] = useState(false);

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
        // Brief delay so React Query can refetch with new workspace
        setReady(false);
        const t = setTimeout(() => {
          setReady(true);
          setSwitching(false);
        }, 300);
        return () => clearTimeout(t);
      } else {
        setReady(true);
        setSwitching(false);
      }
    } else if (workspaces.length > 0) {
      router.replace(`/ws/${workspaces[0].slug}/inbox`);
    }
  }, [slug, workspaces, isLoading, activeWorkspaceId, setActiveWorkspace, setSwitching, router]);

  if (isLoading || switching || !ready) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {switching ? "Switching workspace..." : "Loading workspace..."}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
