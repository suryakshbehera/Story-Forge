import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Runs on every container boot (see the repo-root Dockerfile's CMD, ordered
// after `prisma migrate deploy` and before `pnpm start`), not just once —
// that's deliberate: re-applying ADMIN_PASSWORD on every run is the only way
// to rotate the admin's own password, since there's no self-service reset
// for the admin account itself (Settings → People only resets *other*
// users' passwords). ADMIN_EMAIL/ADMIN_PASSWORD must both be set — this
// must never silently no-op in production, so it exits loudly if either is
// missing rather than skipping.
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set to bootstrap the admin account.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, role: "ADMIN" },
  });

  // Pre-auth Project rows (created before this feature existed) have no
  // owner — assign them to the admin so they don't become inaccessible.
  const backfilled = await prisma.project.updateMany({
    where: { ownerId: null },
    data: { ownerId: admin.id },
  });

  console.log(`Admin bootstrap OK (${email}). Backfilled ${backfilled.count} ownerless project(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
