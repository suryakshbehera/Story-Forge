import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

// Auth core — session cookies backed by a DB-stored, hashed opaque token
// (not JWTs: revocable by deleting the row, no denylist needed). proxy.ts is
// the only place that ever validates a raw cookie token against the
// Session table; everywhere else reads the trusted x-user-id/x-user-role
// headers proxy already attached, so a normal page/route never repeats that
// DB round trip. See proxy.ts for the authorization side of this.

export const SESSION_COOKIE_NAME = "narrata_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, no sliding renewal

// bcryptjs — pure JS, no native compile step. Deliberately avoids adding
// another node-gyp/native-binary build to the Dockerfile alongside Prisma's
// query engine and ffmpeg, both of which already needed real care to get
// working reliably in that image.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Creates a Session row and returns the RAW token — callers set this as the
// cookie themselves (setSessionCookie). Never persisted in plaintext: only
// its sha256 hash is stored, so a DB read/leak alone can't be replayed.
export async function createSession(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return raw;
}

export async function setSessionCookie(raw: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

// The one real DB lookup per request — called only from proxy.ts.
export async function getUserFromToken(raw: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySessionByToken(raw: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(raw) } });
}

export interface CurrentUser {
  id: string;
  role: "ADMIN" | "USER";
}

// For use in Server Components / Route Handlers downstream of proxy.ts —
// reads the trusted headers proxy attached via
// NextResponse.next({ request: { headers } }) rather than redoing the
// session/expiry check on every call. Returns null rather than throwing if
// the headers are missing (e.g. proxy didn't run for some reason), so
// callers fail closed into their own "must log in" state instead of
// crashing.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const h = await headers();
  const id = h.get("x-user-id");
  const role = h.get("x-user-role");
  if (!id || (role !== "ADMIN" && role !== "USER")) return null;
  return { id, role };
}

// For call sites needing more than id/role (e.g. "logged in as ___" in
// SiteHeader) — one extra lookup keyed by id (indexed PK), not a repeat of
// the session/expiry check proxy already did.
export async function getCurrentUserDetail() {
  const basic = await getCurrentUser();
  if (!basic) return null;
  return prisma.user.findUnique({ where: { id: basic.id } });
}
