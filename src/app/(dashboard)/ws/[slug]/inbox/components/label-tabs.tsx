"use client";

import { useLabels } from "@/hooks/use-labels";
import { useInboxStore } from "@/stores/inbox-store";
import { cn } from "@/lib/utils";
import { Search, Plus, X } from "lucide-react";
import { SidebarToggle } from "../../../../components/app-sidebar";
import { useState } from "react";

export function LabelTabs() {
  const { data: labels } = useLabels();
  const { selectedLabelId, setSelectedLabel, searchQuery, setSearchQuery } =
    useInboxStore();
  const [showSearch, setShowSearch] = useState(false);

  return (
    <div className="border-b border-border bg-background">
      {/* Search bar */}
      {showSearch && (
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {searchQuery && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              keyword &ldquo;{searchQuery}&rdquo;
            </span>
          )}
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Label tabs */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto">
        {/* Sidebar toggle */}
        <SidebarToggle />

        {/* All messages tab */}
        <button
          onClick={() => setSelectedLabel(null)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors shrink-0",
            !selectedLabelId
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          All messages
        </button>

        {/* Label tabs */}
        {labels?.map(
          (label: {
            id: string;
            name: string;
            color: string;
            _count: { threadLabels: number };
          }) => {
            const active = selectedLabelId === label.id;
            return (
              <button
                key={label.id}
                onClick={() =>
                  setSelectedLabel(active ? null : label.id)
                }
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors shrink-0",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                  aria-hidden
                />
                {label.name}
                {label._count.threadLabels > 0 && (
                  <span
                    className="h-[18px] px-1.5 inline-flex items-center rounded-full text-[10px] font-semibold tabular-nums"
                    style={{
                      backgroundColor: `${label.color}22`,
                      color: label.color,
                      boxShadow: `inset 0 0 0 1px ${label.color}40`,
                    }}
                  >
                    {label._count.threadLabels > 99 ? "99+" : label._count.threadLabels}
                  </span>
                )}
              </button>
            );
          }
        )}

        <button
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded-md shrink-0 transition-colors"
          title="Create label"
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Spacer + Search */}
        <div className="flex-1" />
        {!showSearch && (
          <button
            onClick={() => setShowSearch(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded-md shrink-0 transition-colors"
            title="Search conversations"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
