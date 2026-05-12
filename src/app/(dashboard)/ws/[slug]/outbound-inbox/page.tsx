"use client";

import { useEffect } from "react";
import { useInboxStore } from "@/stores/inbox-store";
import { LabelTabs } from "../inbox/components/label-tabs";
import { ThreadList } from "../inbox/components/thread-list";
import { ThreadDetail } from "../inbox/components/thread-detail";

export default function OutboundInboxPage() {
  const { setView, setIsOutbound, selectedThreadId } = useInboxStore();

  // This page shows non-campaign contacts only
  useEffect(() => {
    setIsOutbound(true);
    setView("OPEN");
  }, [setIsOutbound, setView]);

  return (
    <div className="flex flex-col h-full">
      <LabelTabs />
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
