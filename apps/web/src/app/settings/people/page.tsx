import { prisma } from "@/lib/db";
import { PeopleManager } from "@/components/people-manager";

export default async function PeopleSettingsPage() {
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ orderBy: { createdAt: "desc" }, include: { usedBy: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-sm text-muted-foreground">
          Manage accounts and generate invite links. New admins are only ever created by the server
          bootstrap step, not from this page.
        </p>
      </div>
      <PeopleManager
        initialUsers={users.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        }))}
        initialInvites={invites.map((i) => ({
          id: i.id,
          code: i.code,
          note: i.note,
          createdAt: i.createdAt.toISOString(),
          usedByEmail: i.usedBy?.email ?? null,
        }))}
      />
    </div>
  );
}
