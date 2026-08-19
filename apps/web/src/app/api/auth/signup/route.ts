import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  code: z.string().optional(),
  invite: z.string().optional(),
});

// Two ways to become a USER (never ADMIN — that role only ever comes from
// the boot-time bootstrap script, see packages/db/src/bootstrap-admin.ts):
// a static SIGNUP_CODE env var, or a one-time Invite code an admin
// generated from Settings → People. Exactly one of the two is required.
export async function POST(req: NextRequest) {
  const body = signupSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 400 });
  }

  const passwordHash = await hashPassword(body.password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      if (body.invite) {
        const invite = await tx.invite.findUnique({ where: { code: body.invite } });
        if (!invite || invite.usedById || (invite.expiresAt && invite.expiresAt < new Date())) {
          throw new SignupError("This invite link is invalid or has already been used.");
        }
        const created = await tx.user.create({ data: { email, passwordHash, role: "USER" } });
        await tx.invite.update({ where: { id: invite.id }, data: { usedById: created.id } });
        return created;
      }

      if (!body.code || body.code !== process.env.SIGNUP_CODE) {
        throw new SignupError("Invalid signup code.");
      }
      return tx.user.create({ data: { email, passwordHash, role: "USER" } });
    });

    const token = await createSession(user.id);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Unique-constraint race (e.g. two requests redeeming the same invite,
    // or the same email, concurrently) — Invite.usedById and User.email are
    // both @unique, backstopping the checks above.
    return NextResponse.json({ error: "Couldn't create account — please try again." }, { status: 400 });
  }
}

class SignupError extends Error {}
