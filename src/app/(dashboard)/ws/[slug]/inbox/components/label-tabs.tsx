"use client";

import { useLabels } from "@/hooks/use-labels";
import { useInboxStore } from "@/stores/inbox-store";
import { Badge } from "@/components/ui/badge";
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
    <div className="border-b bg-background">
      {/* Search bar */}
      {showSearch && (
        <div className="px-4 py-2 border-b flex items-center gap-2">
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
      <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto">
        {/* Sidebar toggle */}
        <SidebarToggle />

        {/* All messages tab */}
        <button
          onClick={() => setSelectedLabel(null)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors shrink-0",
            !selectedLabelId
              ? "bg-muted font-medium"
              : "hover:bg-muted/50 text-muted-foreground"
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
          }) => (
            <button
              key={label.id}
              onClick={() =>
                setSelectedLabel(selectedLabelId === label.id ? null : label.id)
              }
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors shrink-0",
                selectedLabelId === label.id
                  ? "bg-muted font-medium"
                  : "hover:bg-muted/50 text-muted-foreground"
              )}
            >
              {label.name}
              {label._count.threadLabels > 0 && (
                <Badge
                  className="h-[18px] px-1.5 text-[10px] font-medium"
                  style={{ backgroundColor: label.color, color: "white" }}
                >
                  {label._count.threadLabels > 99 ? "99+" : label._count.threadLabels}
                  {" new"}
                </Badge>
              )}
            </button>
          )
        )}

        <button className="p-1.5 text-muted-foreground hover:text-foreground shrink-0">
          <Plus className="h-4 w-4" />
        </button>

        {/* Spacer + Search */}
        <div className="flex-1" />
        {!showSearch && (
          <button
            onClick={() => setShowSearch(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
