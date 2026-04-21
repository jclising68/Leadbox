"use client";

import { NotificationsBell } from "./notifications-bell";
import { ProfileDropdown } from "./profile-dropdown";

export function AppHeader() {
  return (
    <header className="flex items-center justify-end gap-1.5 h-12 pl-3 pr-5 border-b border-border bg-background/60 backdrop-blur-sm shrink-0">
      <NotificationsBell />
      <ProfileDropdown />
    </header>
  );
}
