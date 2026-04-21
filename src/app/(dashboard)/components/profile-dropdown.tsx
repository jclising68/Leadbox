"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Moon, Sun, Settings, LogOut, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/stores/workspace-store";

type UserProfile = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
};

function initials(name: string | null, email: string | null | undefined) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

export function ProfileDropdown() {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspaceId } = useWorkspaceStore();
  const activeSlug = workspaces?.find((w: { id: string }) => w.id === activeWorkspaceId)?.slug;

  // Prefer profile API (has avatar URL). Fall back to session fields.
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const res = await fetch("/api/user/profile", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    staleTime: 60000,
    enabled: !!session,
  });

  const displayName = profile?.name ?? session?.user?.name ?? null;
  const email = profile?.email ?? session?.user?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? session?.user?.image ?? null;

  const settingsHref = activeSlug ? `/ws/${activeSlug}/settings/personal` : "/settings/personal";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label="Account menu"
      >
        <Avatar size="sm">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName ?? email} /> : null}
          <AvatarFallback>{initials(displayName, email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar size="sm">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName ?? email} /> : null}
            <AvatarFallback>{initials(displayName, email)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{displayName ?? "Account"}</div>
            <div className="text-xs text-muted-foreground truncate">{email}</div>
          </div>
        </div>
        <div className="border-t my-1" />
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="gap-2"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{isDark ? "Light mode" : "Dark mode"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={settingsHref} />} className="gap-2">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={settingsHref} />} className="gap-2">
          <UserIcon className="h-4 w-4" />
          <span>Personal details</span>
        </DropdownMenuItem>
        <div className="border-t my-1" />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          <span>Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
