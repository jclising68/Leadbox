"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type InboxView = "ALL" | "OPEN" | "ARCHIVED" | "SPAM" | "TRASH";

type InboxStore = {
  view: InboxView;
  selectedThreadId: string | null;
  selectedLabelId: string | null;
  searchQuery: string;
  sidebarCollapsed: boolean;
  filterChannel: string | null;
  filterProvider: string | null;
  filterCampaign: string | null;
  filterUnread: boolean;
  filterHasReply: boolean;
  filterDateFrom: string | null;
  filterDateTo: string | null;
  sortDir: "desc" | "asc";
  setView: (view: InboxView) => void;
  setSelectedThread: (id: string | null) => void;
  setSelectedLabel: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleSidebar: () => void;
  setFilterChannel: (ch: string | null) => void;
  setFilterProvider: (p: string | null) => void;
  setFilterCampaign: (c: string | null) => void;
  setFilterUnread: (u: boolean) => void;
  setFilterHasReply: (h: boolean) => void;
  setFilterDateFrom: (d: string | null) => void;
  setFilterDateTo: (d: string | null) => void;
  setSortDir: (d: "desc" | "asc") => void;
  clearFilters: () => void;
};

export const useInboxStore = create<InboxStore>()(
  persist(
    (set) => ({
      view: "OPEN",
      selectedThreadId: null,
      selectedLabelId: null,
      searchQuery: "",
      sidebarCollapsed: false,
      filterChannel: null,
      filterProvider: null,
      filterCampaign: null,
      filterUnread: false,
      filterHasReply: false,
      filterDateFrom: null,
      filterDateTo: null,
      sortDir: "desc",
      setView: (view) => set({ view, selectedLabelId: null }),
      setSelectedThread: (id) => set({ selectedThreadId: id }),
      setSelectedLabel: (id) => set({ selectedLabelId: id, view: "ALL" }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setFilterChannel: (ch) => set({ filterChannel: ch }),
      setFilterProvider: (p) => set({ filterProvider: p }),
      setFilterCampaign: (c) => set({ filterCampaign: c }),
      setFilterUnread: (u) => set({ filterUnread: u }),
      setFilterHasReply: (h) => set({ filterHasReply: h }),
      setFilterDateFrom: (d) => set({ filterDateFrom: d }),
      setFilterDateTo: (d) => set({ filterDateTo: d }),
      setSortDir: (d) => set({ sortDir: d }),
      clearFilters: () => set({ filterChannel: null, filterProvider: null, filterCampaign: null, filterUnread: false, filterHasReply: false, filterDateFrom: null, filterDateTo: null, searchQuery: "" }),
    }),
    {
      name: "leadbox-inbox",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);
