"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";

const PRESET_COLORS = [
  "#22C55E", "#EF4444", "#3B82F6", "#A855F7", "#F97316",
  "#6B7280", "#EAB308", "#EC4899", "#8B5CF6", "#14B8A6",
];

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

export default function LabelsPage() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const { data: labels, isLoading } = useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/labels", {
        headers: headers(workspaceId!),
      });
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const createLabel = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: headers(workspaceId!),
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) throw new Error("Failed to create label");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      setOpen(false);
      setName("");
      toast.success("Label created");
    },
  });

  const deleteLabel = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/labels/${id}`, {
        method: "DELETE",
        headers: headers(workspaceId!),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Label deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Labels</h1>
          <p className="text-sm text-muted-foreground">
            Manage labels for categorizing conversations
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Add Label
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Label</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Label name"
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full border-2 ${
                        color === c ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => createLabel.mutate()}
                disabled={!name || createLabel.isPending}
              >
                Create Label
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Threads</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels?.map(
              (label: {
                id: string;
                name: string;
                color: string;
                isSystem: boolean;
                _count: { threadLabels: number };
              }) => (
                <TableRow key={label.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="font-medium">{label.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {label.isSystem ? "System" : "Custom"}
                    </Badge>
                  </TableCell>
                  <TableCell>{label._count.threadLabels}</TableCell>
                  <TableCell>
                    {!label.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteLabel.mutate(label.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
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
