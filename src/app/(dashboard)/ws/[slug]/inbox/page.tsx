"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useInboxStore } from "@/stores/inbox-store";
import { LabelTabs } from "./components/label-tabs";
import { ThreadList } from "./components/thread-list";
import { ThreadDetail } from "./components/thread-detail";

export default function InboxPage() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const { setView, selectedThreadId } = useInboxStore();

  useEffect(() => {
    if (status) {
      setView(status as "ARCHIVED" | "SPAM" | "TRASH");
    } else if (!selectedThreadId) {
      // Only reset to OPEN if no thread is pre-selected (e.g. from leads page).
      // When a thread is pre-selected, keep the current view (set by the caller).
      setView("OPEN");
    }
  }, [status, setView, selectedThreadId]);

  return (
    <div className="flex flex-col h-full">
      {/* Label tabs at top - like Master Inbox */}
      <LabelTabs />

      {/* Main content: thread list + thread detail */}
      <div className="flex flex-1 overflow-hidden">
        <ThreadList />
        {selectedThreadId ? (
          <ThreadDetail />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">Select a conversation to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
