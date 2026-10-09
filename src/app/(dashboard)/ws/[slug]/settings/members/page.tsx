"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useWorkspaces } from "@/hooks/use-workspace";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  UserPlus,
  X,
  Sparkles,
  Pencil,
  ChevronsUpDown,
  Lock,
} from "lucide-react";

function initials(name: string | null | undefined, email: string) {
  const source = (name || email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const chars = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return chars.toUpperCase() || source.slice(0, 2).toUpperCase();
}

const roleStyles: Record<string, string> = {
  OWNER:
    "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30",
  ADMIN:
    "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-inset ring-sky-500/30",
  MEMBER:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
  VIEWER:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

function headers(wId: string) {
  return { "x-workspace-id": wId, "Content-Type": "application/json" };
}

type Workspace = { id: string; name: string; slug: string };
type UnassignedUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  memberships: { workspace: { id: string; name: string } }[];
};
type AddableUser = {
  id: string;
  email: string;
  name: string | null;
  memberships: { workspace: { id: string; name: string } }[];
};

export default function MembersPage() {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [lockedWorkspaceIds, setLockedWorkspaceIds] = useState<string[]>([]);
  const [emailPickerOpen, setEmailPickerOpen] = useState(false);
  const [dismissedUserIds, setDismissedUserIds] = useState<Set<string>>(new Set());
  const [editingMember, setEditingMember] = useState<{
    userId: string;
    name: string | null;
    email: string;
    role: string;
  } | null>(null);
  const [editRole, setEditRole] = useState("MEMBER");
  // null = no local toggles yet; selection derives from the fetched memberships
  const [editWorkspaceIdsOverride, setEditWorkspaceIdsOverride] = useState<string[] | null>(null);

  const { data: allWorkspaces } = useWorkspaces();

  function openAddDialog(
    prefillEmail = "",
    alreadyMemberOf: string[] = []
  ) {
    setEmail(prefillEmail);
    setRole("MEMBER");
    setLockedWorkspaceIds(alreadyMemberOf);
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

  const { data: addableUsers } = useQuery({
    queryKey: ["addable-users", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/users/addable", {
        headers: headers(workspaceId!),
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json() as Promise<AddableUser[]>;
    },
    enabled: !!workspaceId && open,
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

  // Edit workspace checkboxes: pre-filled from memberships, overridden once the user toggles
  const editWorkspaceIds =
    editWorkspaceIdsOverride ??
    (editingMember && editMemberships ? editMemberships.map((m) => m.workspaceId) : []);

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
    setEditWorkspaceIdsOverride(null); // derived from the query
  }

  function toggleEditWorkspace(id: string) {
    setEditWorkspaceIdsOverride(
      editWorkspaceIds.includes(id)
        ? editWorkspaceIds.filter((w) => w !== id)
        : [...editWorkspaceIds, id]
    );
  }

  function toggleWorkspace(id: string) {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  }

  const workspaces = (allWorkspaces?.workspaces || allWorkspaces || []) as Workspace[];

  // Filter out dismissed users
  const visibleUnassigned = ((unassignedUsers as UnassignedUser[]) || []).filter(
    (u) => !dismissedUserIds.has(u.id)
  );

  return (
    <div className="max-w-3xl">
      {/* Unassigned users notification */}
      {visibleUnassigned.length > 0 && (
        <div className="mb-6 rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/70 bg-muted/40">
            <div className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-inset ring-amber-500/30">
              <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                New registrations
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({visibleUnassigned.length})
                </span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Users who signed up but haven&apos;t been placed in any workspace yet
              </p>
            </div>
          </div>
          <div className="divide-y divide-border/70">
            {visibleUnassigned.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-medium text-xs">
                  {initials(user.name, user.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate text-foreground">
                      {user.name || user.email}
                    </span>
                    {user.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Registered {new Date(user.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 ml-3 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 text-xs gap-1.5"
                    onClick={() =>
                      openAddDialog(
                        user.email,
                        user.memberships.map((m) => m.workspace.id)
                      )
                    }
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Assign
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() =>
                      setDismissedUserIds((prev) => new Set([...prev, user.id]))
                    }
                    title="Dismiss"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
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
                <Popover
                  open={emailPickerOpen}
                  onOpenChange={setEmailPickerOpen}
                >
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40 transition-colors"
                      >
                        <span className={email ? "text-foreground" : "text-muted-foreground"}>
                          {email || "Pick a registered user or type an email"}
                        </span>
                        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    }
                  />
                  <PopoverContent
                    align="start"
                    className="w-[min(calc(100vw-3rem),28rem)] p-0"
                  >
                    <Command>
                      <CommandInput
                        placeholder="Search users or type new email…"
                        value={email}
                        onValueChange={(v) => {
                          setEmail(v);
                          const match = (addableUsers || []).find(
                            (u) => u.email.toLowerCase() === v.toLowerCase()
                          );
                          setLockedWorkspaceIds(
                            match
                              ? match.memberships.map((m) => m.workspace.id)
                              : []
                          );
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="text-xs text-muted-foreground">
                            {email
                              ? "Not registered yet — they'll be invited."
                              : "No registered users available."}
                          </div>
                        </CommandEmpty>
                        {(addableUsers || []).length > 0 && (
                          <CommandGroup heading="Registered users">
                            {(addableUsers || []).map((u) => (
                              <CommandItem
                                key={u.id}
                                value={`${u.email} ${u.name ?? ""}`}
                                onSelect={() => {
                                  setEmail(u.email);
                                  setLockedWorkspaceIds(
                                    u.memberships.map((m) => m.workspace.id)
                                  );
                                  setEmailPickerOpen(false);
                                }}
                              >
                                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                                  {initials(u.name, u.email)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium truncate text-foreground">
                                    {u.name || u.email}
                                  </div>
                                  {u.name && (
                                    <div className="text-xs text-muted-foreground truncate">
                                      {u.email}
                                    </div>
                                  )}
                                </div>
                                {u.memberships.length > 0 && (
                                  <div className="text-[10px] text-muted-foreground shrink-0">
                                    {u.memberships.length} workspace
                                    {u.memberships.length > 1 ? "s" : ""}
                                  </div>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
                <div className="rounded-md border border-border/70 bg-muted/20 max-h-48 overflow-y-auto divide-y divide-border/70">
                  {workspaces.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No workspaces found
                    </div>
                  ) : (
                    workspaces.map((ws: Workspace) => {
                      const locked = lockedWorkspaceIds.includes(ws.id);
                      return (
                        <label
                          key={ws.id}
                          className={`flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                            locked
                              ? "bg-muted/40 cursor-not-allowed"
                              : "hover:bg-muted/50 cursor-pointer"
                          }`}
                        >
                          <Checkbox
                            checked={locked || selectedWorkspaceIds.includes(ws.id)}
                            disabled={locked}
                            onCheckedChange={() =>
                              !locked && toggleWorkspace(ws.id)
                            }
                          />
                          <span
                            className={`text-sm ${
                              locked ? "text-muted-foreground" : "text-foreground"
                            }`}
                          >
                            {ws.name}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            {locked && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                                <Lock className="h-2.5 w-2.5" />
                                already a member
                              </span>
                            )}
                            {ws.id === workspaceId && !locked && (
                              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">
                                current
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })
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
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/70">
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Member
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Role
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Joined
                </TableHead>
                <TableHead className="w-0"></TableHead>
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
                  <TableRow
                    key={m.id}
                    className="border-b border-border/70 last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-medium text-xs">
                          {initials(m.user.name, m.user.email)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {m.user.name || m.user.email}
                          </div>
                          {m.user.name && (
                            <div className="text-xs text-muted-foreground truncate">
                              {m.user.email}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          roleStyles[m.role] ?? roleStyles.VIEWER
                        }`}
                      >
                        {m.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {m.role !== "OWNER" && (
                        <div className="flex items-center gap-0.5 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(m)}
                            title="Edit member"
                            className="h-8 w-8 p-0"
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMember.mutate(m.user.id)}
                            title="Remove member"
                            className="h-8 w-8 p-0 hover:bg-destructive/10"
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
        </div>
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
                <div className="rounded-md border border-border/70 bg-muted/20 max-h-48 overflow-y-auto divide-y divide-border/70">
                  {workspaces.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No workspaces found
                    </div>
                  ) : (
                    workspaces.map((ws: Workspace) => (
                      <label
                        key={ws.id}
                        className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={editWorkspaceIds.includes(ws.id)}
                          onCheckedChange={() => toggleEditWorkspace(ws.id)}
                        />
                        <span className="text-sm text-foreground">{ws.name}</span>
                        {ws.id === workspaceId && (
                          <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">
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
