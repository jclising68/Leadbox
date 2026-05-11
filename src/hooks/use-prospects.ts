"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useEffect, useState } from "react";

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useProspects({
  search = "",
  sortBy = "lastMessageAt",
  sortDir = "desc",
  label = "",
  channel = "",
  provider = "",
  domain = "",
  dateFrom,
  dateTo,
  leadStatus = "",
  showUnsubscribed = false,
}: {
  search?: string;
  sortBy?: string;
  sortDir?: string;
  label?: string;
  channel?: string;
  provider?: string;
  domain?: string;
  dateFrom?: string;
  dateTo?: string;
  leadStatus?: string;
  showUnsubscribed?: boolean;
} = {}) {
  const workspaceId = useCurrentWorkspaceId();
  const debouncedSearch = useDebounce(search, 300);

  return useInfiniteQuery({
    queryKey: ["prospects", workspaceId, debouncedSearch, sortBy, sortDir, label, channel, provider, domain, dateFrom, dateTo, leadStatus, showUnsubscribed],
    queryFn: async ({ pageParam }) => {
      if (!workspaceId) return { prospects: [], nextCursor: null, hasMore: false };

      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDir) params.set("sortDir", sortDir);
      if (label) params.set("label", label);
      if (channel) params.set("channel", channel);
      if (provider) params.set("provider", provider);
      if (domain) params.set("domain", domain);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (leadStatus) params.set("leadStatus", leadStatus);
      if (showUnsubscribed) params.set("showUnsubscribed", "true");
      if (pageParam) params.set("cursor", pageParam);
      params.set("hasReply", "true");
      params.set("limit", "100");

      const res = await fetch(`/api/prospects?${params}`, {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch prospects");
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!workspaceId,
    staleTime: 10000,
    gcTime: 300000,
  });
}
