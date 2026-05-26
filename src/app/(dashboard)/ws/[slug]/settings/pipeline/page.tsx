"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2, Loader2, Kanban } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

type PipelineRow = {
  id: string;
  name: string;
  _count: { deals: number };
  stages: { id: string }[];
};

export default function PipelineSettingsPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const params = useParams<{ slug: string }>();

  const { data: pipelines = [], isLoading } = useQuery<PipelineRow[]>({
    queryKey: ["pipelines", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/pipeline", {
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) throw new Error("Failed to load pipelines");
      return res.json();
    },
    enabled: !!workspaceId,
    staleTime: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (pipeline: PipelineRow) => {
      if (pipeline._count.deals > 0) {
        throw new Error(`Move or delete the ${pipeline._count.deals} deal(s) in "${pipeline.name}" first`);
      }
      const res = await fetch(`/api/pipeline/${pipeline.id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId! },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to delete pipeline");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
      toast.success("Pipeline deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your pipelines. To create pipelines or edit stages, go to the{" "}
            <Link
              href={`/ws/${params.slug}/pipeline`}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Pipeline page
            </Link>
            .
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : pipelines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Kanban className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm mb-3">No pipelines yet.</p>
          <Link
            href={`/ws/${params.slug}/pipeline`}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            Go to Pipeline page
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 transition-colors"
            >
              <Kanban className="h-4 w-4 text-muted-foreground shrink-0 opacity-60" />
              <span className="flex-1 text-sm font-medium">{pipeline.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {pipeline.stages.length} stage{pipeline.stages.length !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {pipeline._count.deals} deal{pipeline._count.deals !== 1 ? "s" : ""}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (!confirm(`Delete pipeline "${pipeline.name}" and all its stages?`)) return;
                  deleteMutation.mutate(pipeline);
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
