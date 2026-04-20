"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Loader2, Trash2 } from "lucide-react";

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

type Workspace = { id: string; name: string; slug: string };

export default function MembersPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);

  const { data: allWorkspaces } = useWorkspaces();

  // Pre-check current workspace when dialog opens
  useEffect(() => {
    if (open && workspaceId) {
      setSelectedWorkspaceIds((prev) =>
        prev.length === 0 ? [workspaceId] : prev
      );
    }
    if (!open) {
      // Reset on close
      setSelectedWorkspaceIds(workspaceId ? [workspaceId] : []);
    }
  }, [open, workspaceId]);

  const { data: members, isLoading } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const addMember = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: headers(workspaceId!),
        body: JSON.stringify({
          email,
          role,
          workspaceIds: selectedWorkspaceIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      setOpen(false);
      setEmail("");
      setRole("MEMBER");
      toast.success("Member added");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "DELETE",
        headers: headers(workspaceId!),
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to remove member");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Member removed");
    },
  });

  function toggleWorkspace(id: string) {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  }

  const roleColor: Record<string, string> = {
    OWNER: "text-yellow-500",
    ADMIN: "text-blue-500",
    MEMBER: "text-green-500",
    VIEWER: "text-gray-500",
  };

  const workspaces = (allWorkspaces?.workspaces || allWorkspaces || []) as Workspace[];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Team Members</h1>
          <p className="text-sm text-muted-foreground">
            Manage who has access to this workspace
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Add Member
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => v && setRole(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Workspace Access</Label>
                <p className="text-xs text-muted-foreground">
                  Select which workspaces this member can access
                </p>
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {workspaces.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No workspaces found
                    </div>
                  ) : (
                    workspaces.map((ws: Workspace) => (
                      <label
                        key={ws.id}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                      >
                        <Checkbox
                          checked={selectedWorkspaceIds.includes(ws.id)}
                          onCheckedChange={() => toggleWorkspace(ws.id)}
                        />
                        <span className="text-sm">{ws.name}</span>
                        {ws.id === workspaceId && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            current
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
                {selectedWorkspaceIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedWorkspaceIds.length} workspace{selectedWorkspaceIds.length > 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
              <Button
                className="w-full"
                onClick={() => addMember.mutate()}
                disabled={!email || selectedWorkspaceIds.length === 0 || addMember.isPending}
              >
                {addMember.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Add Member
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
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members?.map(
              (m: {
                id: string;
                role: string;
                joinedAt: string;
                user: { id: string; name: string | null; email: string };
              }) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.user.name || "-"}
                  </TableCell>
                  <TableCell>{m.user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColor[m.role]}>
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {m.role !== "OWNER" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember.mutate(m.user.id)}
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
