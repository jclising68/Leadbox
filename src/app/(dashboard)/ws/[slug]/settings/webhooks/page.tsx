"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

export default function WebhooksPage() {
  const workspaceId = useCurrentWorkspaceId();

  const { data: logs, isLoading } = useQuery({
    queryKey: ["webhook-logs", workspaceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/webhooks/logs?workspace_id=${workspaceId}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
    refetchInterval: 15000,
  });

  const statusColor: Record<string, string> = {
    PROCESSED: "text-green-500 border-green-500",
    PENDING: "text-yellow-500 border-yellow-500",
    FAILED: "text-red-500 border-red-500",
    SKIPPED: "text-gray-500 border-gray-500",
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Webhook Logs</h1>
        <p className="text-sm text-muted-foreground">
          Recent incoming webhook events (auto-refreshes every 15s)
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !logs?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No webhook events received yet. Connect an integration and configure
          the webhook URL to start receiving events.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map(
              (log: {
                id: string;
                createdAt: string;
                provider: string;
                eventType: string;
                status: string;
                errorMessage: string | null;
              }) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.provider}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {log.eventType}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusColor[log.status]}
                    >
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {log.errorMessage || "-"}
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
