import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

const resetSchema = z.object({ password: z.string().min(8, "Password must be at least 8 characters") });

// Admin-only (gated by proxy.ts's ADMIN_ONLY_PREFIXES on /api/admin) — the
// manual password-reset path decided in place of self-service email reset,
// since this app has no email-sending infra.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = resetSchema.parse(await req.json());

  const passwordHash = await hashPassword(body.password);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
}
