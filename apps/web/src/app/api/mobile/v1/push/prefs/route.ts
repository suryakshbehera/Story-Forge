import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Not in proxy.ts's RESOLVERS — same reasoning as /push/register: PushDevice
// is owned by User, checked per-handler.

const prefsSchema = z.object({
  installId: z.string().min(1),
  mutedProjectIds: z.array(z.string()).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  // Same sign convention as JS's Date.prototype.getTimezoneOffset() — see
  // lib/notify.ts's localHour().
  timezoneOffsetMinutes: z.number().int().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { installId, ...prefs } = prefsSchema.parse(await req.json());
  const result = await prisma.pushDevice.updateMany({
    where: { userId: currentUser.id, installId },
    data: prefs,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Device not registered" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
