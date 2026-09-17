import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Not in proxy.ts's RESOLVERS — a PushDevice is owned by User, not Project
// (same structural reason as CaptureItem), so there's no project-ownership
// check to make; each handler checks userId itself.

const registerSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(["ios", "android"]),
  installId: z.string().min(1),
  name: z.string().optional(),
});

// One row per app install, not per session — upsert by (userId, installId)
// so re-registering (app relaunch, token refresh) updates in place rather
// than accumulating rows. See PushDevice in schema.prisma.
export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = registerSchema.parse(await req.json());
  const device = await prisma.pushDevice.upsert({
    where: { userId_installId: { userId: currentUser.id, installId: body.installId } },
    create: {
      userId: currentUser.id,
      expoPushToken: body.expoPushToken,
      platform: body.platform,
      installId: body.installId,
      name: body.name,
    },
    update: { expoPushToken: body.expoPushToken, platform: body.platform, name: body.name, lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true, id: device.id });
}

const revokeSchema = z.object({ installId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = revokeSchema.parse(await req.json());
  await prisma.pushDevice.deleteMany({ where: { userId: currentUser.id, installId: body.installId } });
  return NextResponse.json({ ok: true });
}
