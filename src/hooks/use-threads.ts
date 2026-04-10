"use client";

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useEffect, useState } from "react";

function buildHeaders(workspaceId: string) {
  return { "x-workspace-id": workspaceId, "Content-Type": "application/json" };
}

// Debounce hook
function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useThreads() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { view, selectedLabelId, searchQuery, filterChannel, filterUnread, filterDateFrom } = useInboxStore();
  const debouncedSearch = useDebounce(searchQuery, 300);

  return useInfiniteQuery({
    queryKey: ["threads", workspaceId, view, selectedLabelId, debouncedSearch, filterChannel, filterUnread, filterDateFrom],
    queryFn: async ({ pageParam }) => {
      if (!workspaceId) return { threads: [], nextCursor: null, hasMore: false };

      const params = new URLSearchParams();
      if (view !== "ALL") params.set("status", view);
      if (selectedLabelId) params.set("labelId", selectedLabelId);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (filterChannel) params.set("channel", filterChannel);
      if (filterUnread) params.set("isUnread", "true");
      if (filterDateFrom) params.set("dateFrom", filterDateFrom);
      if (pageParam) params.set("cursor", pageParam);
      params.set("hasReply", "true");
      params.set("limit", "50");

      const res = await fetch(`/api/threads?${params}`, {
        headers: buildHeaders(workspaceId),
      });
      if (!res.ok) throw new Error("Failed to fetch threads");
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!workspaceId,
    refetchInterval: 15000,
    staleTime: 5000,
    gcTime: 300000, // Keep in cache for 5 min
  });
}

export function useThread(threadId: string | null) {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useQuery({
    queryKey: ["thread", threadId, workspaceId],
    queryFn: async () => {
      if (!workspaceId || !threadId) return null;
      const res = await fetch(`/api/threads/${threadId}`, {
        headers: buildHeaders(workspaceId),
      });
      if (!res.ok) throw new Error("Failed to fetch thread");
      return res.json();
    },
    enabled: !!workspaceId && !!threadId,
    staleTime: 10000,
    gcTime: 300000,
  });
}

export function useUpdateThread() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: async ({
      threadId,
      data,
    }: {
      threadId: string;
      data: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: buildHeaders(workspaceId!),
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["thread"] });
    },
  });
}

export function useAddLabel() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: async ({ threadId, labelId }: { threadId: string; labelId: string }) => {
      const res = await fetch(`/api/threads/${threadId}/labels`, {
        method: "POST",
        headers: buildHeaders(workspaceId!),
        body: JSON.stringify({ labelId }),
      });
      if (!res.ok) throw new Error("Failed to add label");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["thread"] });
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function useRemoveLabel() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: async ({ threadId, labelId }: { threadId: string; labelId: string }) => {
      const res = await fetch(`/api/threads/${threadId}/labels`, {
        method: "DELETE",
        headers: buildHeaders(workspaceId!),
        body: JSON.stringify({ labelId }),
      });
      if (!res.ok) throw new Error("Failed to remove label");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["thread"] });
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function useSendReply() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      const res = await fetch(`/api/threads/${threadId}/reply`, {
        method: "POST",
        headers: buildHeaders(workspaceId!),
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }
      return res.json();
    },
    onSuccess: (_data, { threadId }) => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}
