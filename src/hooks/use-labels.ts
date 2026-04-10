"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useLabels() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await fetch("/api/labels", {
        headers: { "x-workspace-id": workspaceId },
      });
      if (!res.ok) throw new Error("Failed to fetch labels");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}
