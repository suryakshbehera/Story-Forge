import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const createSchema = z.object({ note: z.string().optional() });

// Admin-only (gated by proxy.ts's ADMIN_ONLY_PREFIXES on /api/admin). The
// resulting code is embedded in a shareable /signup?invite=<code> URL the
// admin copies and sends manually — no email-sending infra in this app.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const body = createSchema.parse(await req.json());

  const invite = await prisma.invite.create({
    data: {
      code: randomBytes(16).toString("hex"),
      note: body.note?.trim() || null,
      createdById: user!.id,
    },
  });

  return NextResponse.json(invite, { status: 201 });
}
