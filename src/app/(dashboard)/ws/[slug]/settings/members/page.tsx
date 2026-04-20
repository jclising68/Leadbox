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
import { Plus, Loader2, Trash2, UserPlus, X, AlertCircle, Pencil } from "lucide-react";

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

type Workspace = { id: string; name: string; slug: string };
type UnassignedUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  memberships: { workspace: { name: string } }[];
};

export default function MembersPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [dismissedUserIds, setDismissedUserIds] = useState<Set<string>>(new Set());
  const [editingMember, setEditingMember] = useState<{
    userId: string;
    name: string | null;
    email: string;
    role: string;
  } | null>(null);
  const [editRole, setEditRole] = useState("MEMBER");
  const [editWorkspaceIds, setEditWorkspaceIds] = useState<string[]>([]);

  const { data: allWorkspaces } = useWorkspaces();

  function openAddDialog(prefillEmail = "") {
    setEmail(prefillEmail);
    setRole("MEMBER");
    setSelectedWorkspaceIds(workspaceId ? [workspaceId] : []);
    setOpen(true);
  }

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

  const { data: unassignedUsers } = useQuery({
    queryKey: ["unassigned-users", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/users/unassigned", {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workspaceId,
    refetchInterval: 60000, // Check every minute
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
      return res.json() as Promise<{
        added: number;
        alreadyMember: number;
        unauthorized: number;
      }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["unassigned-users"] }),
        queryClient.invalidateQueries({ queryKey: ["user-memberships"] }),
      ]);
      setOpen(false);
      if (result.added > 0) {
        toast.success(
          `Added to ${result.added} workspace${result.added > 1 ? "s" : ""}`
        );
      } else {
        toast.info("User is already a member of the selected workspace(s)");
      }
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["unassigned-users"] }),
        queryClient.invalidateQueries({ queryKey: ["user-memberships"] }),
      ]);
      toast.success("Member removed");
    },
  });

  // Fetch memberships for the user being edited — must be fresh (no stale cache)
  const { data: editMemberships, isLoading: editMembershipsLoading } = useQuery({
    queryKey: ["user-memberships", editingMember?.userId],
    staleTime: 0, // always refetch when dialog opens
    queryFn: async () => {
      const res = await fetch(`/api/users/${editingMember!.userId}/memberships`, {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json() as Promise<{ workspaceId: string; role: string }[]>;
    },
    enabled: !!editingMember && !!workspaceId,
  });

  // Pre-fill edit workspace checkboxes when memberships load
  useEffect(() => {
    if (editMemberships && editingMember) {
      setEditWorkspaceIds(editMemberships.map((m) => m.workspaceId));
    }
  }, [editMemberships, editingMember]);

  const updateMember = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "PATCH",
        headers: headers(workspaceId!),
        body: JSON.stringify({
          userId: editingMember!.userId,
          role: editRole,
          workspaceIds: editWorkspaceIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      return res.json();
    },
    onSuccess: async () => {
      // Wait for all caches to refetch before closing dialog
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: ["unassigned-users"] }),
        queryClient.invalidateQueries({ queryKey: ["user-memberships"] }),
      ]);
      setEditingMember(null);
      toast.success("Member updated");
    },
    onError: (err) => toast.error(err.message),
  });

  function openEditDialog(member: {
    role: string;
    user: { id: string; name: string | null; email: string };
  }) {
    setEditingMember({
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
    });
    setEditRole(member.role);
    setEditWorkspaceIds([]); // will be filled by the query
  }

  function toggleEditWorkspace(id: string) {
    setEditWorkspaceIds((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  }

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

  // Filter out dismissed users
  const visibleUnassigned = ((unassignedUsers as UnassignedUser[]) || []).filter(
    (u) => !dismissedUserIds.has(u.id)
  );

  return (
    <div className="max-w-3xl">
      {/* Unassigned users notification */}
      {visibleUnassigned.length > 0 && (
        <div className="mb-6 border border-amber-500/30 bg-amber-500/5 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-medium">
              New Registrations ({visibleUnassigned.length})
            </h3>
            <span className="text-xs text-muted-foreground">
              These users registered but are not in this workspace yet
            </span>
          </div>
          <div className="space-y-2">
            {visibleUnassigned.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between bg-background rounded-md border px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {user.name || user.email}
                    </span>
                    {user.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      Registered {new Date(user.createdAt).toLocaleDateString()}
                    </span>
                    {user.memberships.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        In: {user.memberships.map((m) => m.workspace.name).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 ml-3 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => openAddDialog(user.email)}
                  >
                    <UserPlus className="h-3 w-3" />
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() =>
                      setDismissedUserIds((prev) => new Set([...prev, user.id]))
                    }
                    title="Dismiss"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Team Members</h1>
          <p className="text-sm text-muted-foreground">
            Manage who has access to this workspace
          </p>
        </div>
        <button
          type="button"
          onClick={() => openAddDialog()}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Member
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
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
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(m)}
                          title="Edit member"
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMember.mutate(m.user.id)}
                          title="Remove member"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      )}

      {/* Edit member dialog */}
      <Dialog
        open={!!editingMember}
        onOpenChange={(v) => !v && setEditingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Member</DialogTitle>
          </DialogHeader>
          {editingMember && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Member</Label>
                <p className="text-sm font-medium">
                  {editingMember.name || editingMember.email}
                </p>
                {editingMember.name && (
                  <p className="text-xs text-muted-foreground">
                    {editingMember.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(v) => v && setEditRole(v)}>
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
                          checked={editWorkspaceIds.includes(ws.id)}
                          onCheckedChange={() => toggleEditWorkspace(ws.id)}
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
                {editWorkspaceIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {editWorkspaceIds.length} workspace
                    {editWorkspaceIds.length > 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
              <Button
                className="w-full"
                onClick={() => updateMember.mutate()}
                disabled={editMembershipsLoading || editWorkspaceIds.length === 0 || updateMember.isPending}
              >
                {(updateMember.isPending || editMembershipsLoading) && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                {editMembershipsLoading ? "Loading..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
