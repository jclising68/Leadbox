"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";

type DueThread = {
  id: string;
  followUpAt: string;
  prospect: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    company: string | null;
  };
};

function prospectName(p: DueThread["prospect"]) {
  return (
    [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
    p.email ||
    "Unknown"
  );
}

export function FollowUpReminder() {
  const workspaceId = useCurrentWorkspaceId();
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const router = useRouter();
  const shownRef = useRef(false);

  const { data } = useQuery<DueThread[]>({
    queryKey: ["follow-ups-due", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/threads/follow-ups", {
        headers: { "x-workspace-id": workspaceId! },
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
    staleTime: 60000,
  });

  useEffect(() => {
    if (!data?.length || shownRef.current) return;

    const sessionKey = `lb:followup:shown:${workspaceId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(sessionKey)) return;

    shownRef.current = true;
    if (typeof window !== "undefined") sessionStorage.setItem(sessionKey, "1");

    const activeSlug = workspaces?.find(
      (w: { id: string }) => w.id === activeWorkspaceId
    )?.slug;

    const items = data.slice(0, 5);

    toast.custom(
      (t) => (
        <div className="w-80 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 shadow-lg p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                <BellRing className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Follow-ups due
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {data.length} reminder{data.length > 1 ? "s" : ""} waiting
                </p>
              </div>
            </div>
            <button
              onClick={() => toast.dismiss(t)}
              className="text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            {items.map((thread) => (
              <button
                key={thread.id}
                onClick={() => {
                  toast.dismiss(t);
                  if (activeSlug) {
                    router.push(`/ws/${activeSlug}/inbox?thread=${thread.id}`);
                  }
                }}
                className="w-full text-left rounded-lg px-3 py-2 bg-white dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors border border-amber-100 dark:border-amber-800"
              >
                <p className="text-xs font-medium text-amber-900 dark:text-amber-100 truncate">
                  {prospectName(thread.prospect)}
                </p>
                {thread.prospect.company && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                    {thread.prospect.company}
                  </p>
                )}
                <p className="text-[10px] text-amber-500 dark:text-amber-500 mt-0.5">
                  Due{" "}
                  {new Date(thread.followUpAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </button>
            ))}
            {data.length > 5 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 text-center pt-1">
                +{data.length - 5} more in your inbox
              </p>
            )}
          </div>
        </div>
      ),
      { duration: Infinity, id: `follow-up-reminder-${workspaceId}` }
    );
  }, [data, workspaceId, activeWorkspaceId, workspaces, router]);

  return null;
}
