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
      <div className="flex flex-1 overflow-hidden bg-background">
        <ThreadList />
        {selectedThreadId ? (
          <ThreadDetail />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-1.5">
              <div className="mx-auto w-10 h-10 rounded-full bg-muted ring-1 ring-inset ring-border flex items-center justify-center mb-2">
                <span className="text-lg text-muted-foreground/70">✉</span>
              </div>
              <p className="text-sm font-medium text-foreground/80">Nothing selected</p>
              <p className="text-xs">Pick a conversation from the list to view it here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
