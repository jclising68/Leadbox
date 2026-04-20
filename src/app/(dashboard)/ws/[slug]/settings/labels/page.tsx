"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Plus, Trash2, Loader2, Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#22C55E", "#EF4444", "#3B82F6", "#A855F7", "#F97316",
  "#6B7280", "#EAB308", "#EC4899", "#8B5CF6", "#14B8A6",
];

type LabelRow = {
  id: string;
  name: string;
  color: string;
  isSystem: boolean;
  _count: { threadLabels: number };
};

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

export default function LabelsPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const { data: labels, isLoading } = useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/labels", {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const resetForm = () => {
    setMode("create");
    setEditingId(null);
    setName("");
    setColor(PRESET_COLORS[0]);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (label: LabelRow) => {
    setMode("edit");
    setEditingId(label.id);
    setName(label.name);
    setColor(label.color);
    setOpen(true);
  };

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
      resetForm();
      toast.success("Label created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateLabel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/labels/${editingId}`, {
        method: "PATCH",
        headers: headers(workspaceId!),
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update label");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      setOpen(false);
      resetForm();
      toast.success("Label updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLabel = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/labels/${id}`, {
        method: "DELETE",
        headers: headers(workspaceId!),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete label");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      toast.success("Label deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleDelete = (label: LabelRow) => {
    const count = label._count.threadLabels;
    const warning =
      count > 0
        ? `Delete "${label.name}"? It is applied to ${count} thread${count === 1 ? "" : "s"} — those assignments will be removed.`
        : `Delete "${label.name}"?`;
    if (typeof window !== "undefined" && !window.confirm(warning)) return;
    deleteLabel.mutate(label.id);
  };

  const handleSubmit = () => {
    if (mode === "edit") updateLabel.mutate();
    else createLabel.mutate();
  };

  const isSubmitting = createLabel.isPending || updateLabel.isPending;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Labels</h1>
          <p className="text-sm text-muted-foreground">
            Manage labels for categorizing conversations
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1">
          <Plus className="h-4 w-4" />
          Add Label
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "edit" ? "Edit Label" : "Create Label"}
            </DialogTitle>
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
                    aria-label={`Select color ${c}`}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all relative",
                      color === c
                        ? "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                        : "ring-1 ring-inset ring-border hover:ring-foreground/40"
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && (
                      <Check className="h-4 w-4 text-white absolute inset-0 m-auto drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!name || isSubmitting}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === "edit" ? "Save Changes" : "Create Label"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Label</TableHead>
                <TableHead className="w-[120px]">Type</TableHead>
                <TableHead className="w-[100px]">Threads</TableHead>
                <TableHead className="w-[110px] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels?.map((label: LabelRow) => {
                const deleting = deleteLabel.isPending && deleteLabel.variables === label.id;
                return (
                  <TableRow key={label.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: label.color }}
                          aria-hidden
                        />
                        <span className="font-medium text-sm">{label.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          label.isSystem
                            ? "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-sky-500/25"
                            : "bg-muted text-muted-foreground ring-border"
                        )}
                      >
                        {label.isSystem ? "System" : "Custom"}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {label._count.threadLabels}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1 pr-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(label)}
                          title="Edit label"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(label)}
                          disabled={deleting}
                          title="Delete label"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          {deleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
