"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Building, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function WorkspacePage() {
  const workspaceId = useCurrentWorkspaceId();
  const { setActiveWorkspace } = useWorkspaceStore();
  const { data: workspaces, isLoading } = useWorkspaces();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to create workspace");
      return res.json();
    },
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspace(ws.id);
      setOpen(false);
      setNewName("");
      toast.success("Workspace created");
    },
    onError: () => toast.error("Failed to create workspace"),
  });

  const updateWorkspace = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to update workspace");
      return res.json();
    },
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setEditingId(null);
      toast.success("Workspace updated");
      // Navigate to new slug if active workspace was renamed
      if (ws.id === workspaceId) {
        router.replace(`/ws/${ws.slug}/settings/workspace`);
      }
    },
    onError: () => toast.error("Failed to update workspace"),
  });

  const deleteWorkspace = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete workspace");
      return res.json();
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace deleted");
      // If deleted active workspace, switch to another
      if (deletedId === workspaceId) {
        const remaining = workspaces?.filter((w: { id: string }) => w.id !== deletedId);
        if (remaining?.length > 0) {
          setActiveWorkspace(remaining[0].id);
          router.replace(`/ws/${remaining[0].slug}/inbox`);
        }
      }
    },
    onError: () => toast.error("Failed to delete workspace"),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Manage your workspaces
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            New Workspace
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Workspace Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Sales Team, Client Name"
                />
              </div>
              <Button
                className="w-full"
                onClick={() => createWorkspace.mutate()}
                disabled={!newName || createWorkspace.isPending}
              >
                Create Workspace
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
        <div className="space-y-3">
          {workspaces?.map((ws: {
            id: string;
            name: string;
            slug: string;
            createdAt: string;
            _count?: { members: number };
            members?: { role: string }[];
          }) => (
            <Card
              key={ws.id}
              className={ws.id === workspaceId ? "border-primary/50" : ""}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      {editingId === ws.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-7 text-sm w-48"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editName.trim()) {
                                updateWorkspace.mutate({ id: ws.id, name: editName.trim() });
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => updateWorkspace.mutate({ id: ws.id, name: editName.trim() })}
                            disabled={!editName.trim() || updateWorkspace.isPending}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <CardTitle className="text-base">{ws.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {ws.slug} &middot; Created {new Date(ws.createdAt).toLocaleDateString()}
                          </CardDescription>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setEditingId(ws.id);
                        setEditName(ws.name);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete workspace "${ws.name}"? This will permanently delete all data in this workspace.`)) {
                          deleteWorkspace.mutate(ws.id);
                        }
                      }}
                      disabled={deleteWorkspace.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    {ws.id === workspaceId ? (
                      <span className="text-xs text-primary font-medium ml-1">Active</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActiveWorkspace(ws.id);
                          router.push(`/ws/${ws.slug}/inbox`);
                        }}
                      >
                        Switch
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{ws._count?.members || ws.members?.length || 1} members</span>
                  <span>Role: {ws.members?.[0]?.role || "OWNER"}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
