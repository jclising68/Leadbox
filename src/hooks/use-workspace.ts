"use client";

import { useQuery } from "@tanstack/react-query";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
  });
}
