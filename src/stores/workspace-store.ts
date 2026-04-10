"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
    }),
    { name: "leadbox-workspace" }
  )
);
