"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plug, Users, Tag, Webhook, Brain, Building, Key, Mail, Kanban } from "lucide-react";

const accountSettings = [
  { label: "Personal details", path: "/settings/personal", icon: Users },
];

const workspaceSettings = [
  { label: "Workspaces", path: "/settings/workspace", icon: Building },
  { label: "Members", path: "/settings/members", icon: Users },
  { label: "Webhooks", path: "/settings/webhooks", icon: Webhook },
  { label: "Integrations", path: "/settings/integrations", icon: Plug },
  { label: "Labels", path: "/settings/labels", icon: Tag },
  { label: "Pipeline", path: "/settings/pipeline", icon: Kanban },
  { label: "AI Integration", path: "/settings/ai-integration", icon: Brain },
  { label: "API Keys", path: "/settings/api-keys", icon: Key },
  { label: "Channels", path: "/settings/channels", icon: Mail },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const slug = params.slug as string;
  const base = `/ws/${slug}`;

  return (
    <div className="flex h-full">
      <div className="w-52 border-r p-3 space-y-1 bg-muted/10">
        <h2 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Account settings
        </h2>
        {accountSettings.map((item) => {
          const href = `${base}${item.path}`;
          return (
            <Link key={item.path} href={href}>
              <Button
                variant={pathname === href ? "secondary" : "ghost"}
                className="w-full justify-start gap-2 h-9 text-sm"
                size="sm"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          );
        })}

        <h2 className="px-3 py-2 pt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Workspace settings
        </h2>
        {workspaceSettings.map((item) => {
          const href = `${base}${item.path}`;
          return (
            <Link key={item.path} href={href}>
              <Button
                variant={pathname === href ? "secondary" : "ghost"}
                className="w-full justify-start gap-2 h-9 text-sm"
                size="sm"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </div>
  );
}
