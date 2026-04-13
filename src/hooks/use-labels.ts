"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";

export function useLabels() {
  const workspaceId = useCurrentWorkspaceId();

  return useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await fetch("/api/labels", {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch labels");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}
