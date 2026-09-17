import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { TokenResponse } from "contract";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkAuthRateLimit } from "@/lib/rate-limit";

// Mobile's login: returns the session token in the JSON body instead of
// setting it as an httpOnly cookie (which is exactly the thing httpOnly
// exists to prevent — kept off /api/auth/login so that route can never
// accidentally acquire this behaviour through a mis-set flag, and so this
// endpoint gets its own rate-limit bucket and its own logs). Same
// credential model as web: a bearer variant of the same Session row, not a
// new credential type. See docs/product/mobile-technical-plan-2026-09.md §2.

// `device` is accepted now (for forward-compat with push registration) but
// not yet acted on here — device/push-token registration is its own
// endpoint, POST /api/mobile/v1/push/register (not built yet).
const tokenSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: z
    .object({
      platform: z.enum(["ios", "android"]),
      installId: z.string().min(1),
      name: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const body = tokenSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  if (!checkAuthRateLimit(req, email)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);

  const response: TokenResponse = {
    token,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, email: user.email, role: user.role },
  };
  return NextResponse.json(response);
}
