"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, KeyRound, Plus } from "lucide-react";

interface UserRow {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  createdAt: string;
}

interface InviteRow {
  id: string;
  code: string;
  note: string | null;
  createdAt: string;
  usedByEmail: string | null;
}

export function PeopleManager({
  initialUsers,
  initialInvites,
}: {
  initialUsers: UserRow[];
  initialInvites: InviteRow[];
}) {
  const [users] = useState(initialUsers);
  const [invites, setInvites] = useState(initialInvites);

  async function createInvite(note: string) {
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note || undefined }),
    });
    if (!res.ok) {
      toast.error("Couldn't create invite.");
      return;
    }
    const invite = await res.json();
    setInvites((prev) => [
      { id: invite.id, code: invite.code, note: invite.note, createdAt: invite.createdAt, usedByEmail: null },
      ...prev,
    ]);
    toast.success("Invite created.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Users</h2>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString("en-US")}
                  </TableCell>
                  <TableCell>
                    <ResetPasswordDialog userId={u.id} userEmail={u.email} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Invites</h2>
          <CreateInviteDialog onCreate={createInvite} />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Note</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No invites yet.
                  </TableCell>
                </TableRow>
              ) : (
                invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.note || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString("en-US")}
                    </TableCell>
                    <TableCell>
                      {inv.usedByEmail ? (
                        <Badge variant="secondary">Used by {inv.usedByEmail}</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!inv.usedByEmail && <CopyInviteLinkButton code={inv.code} />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReset() {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Password reset for ${userEmail}.`);
      setOpen(false);
      setPassword("");
    } catch {
      toast.error("Couldn't reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <KeyRound className="size-3.5" />
        Reset password
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {userEmail}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button onClick={handleReset} disabled={submitting}>
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateInviteDialog({ onCreate }: { onCreate: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setSubmitting(true);
    await onCreate(note.trim());
    setSubmitting(false);
    setOpen(false);
    setNote("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" />
        New Invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Invite</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="invite-note">Note (optional)</Label>
          <Input
            id="invite-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. for Priya"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating…" : "Create Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyInviteLinkButton({ code }: { code: string }) {
  async function copyLink() {
    const url = `${window.location.origin}/signup?invite=${code}`;
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied.");
  }

  return (
    <Button size="sm" variant="ghost" onClick={copyLink}>
      <Copy className="size-3.5" />
      Copy link
    </Button>
  );
}
