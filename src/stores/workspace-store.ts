"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type WorkspaceStore = {
  activeWorkspaceId: string | null;
  switching: boolean;
  setActiveWorkspace: (id: string) => void;
  setSwitching: (v: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      switching: false,
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id, switching: true }),
      setSwitching: (v) => set({ switching: v }),
    }),
    { name: "leadbox-workspace", partialize: (state) => ({ activeWorkspaceId: state.activeWorkspaceId }) }
  )
);
