import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SHOT_INCLUDE, mapShotImages, resequenceShots } from "@/lib/shots";

const patchSchema = z.object({
  description: z.string().min(1).optional(),
  cameraMovement: z.enum(["STATIC", "ZOOM_IN", "ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "PAN_DOWN"]).optional(),
  durationSeconds: z.number().int().positive().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const shot = await prisma.shot.update({
    where: { id },
    data: body,
    include: SHOT_INCLUDE,
  });

  return NextResponse.json(mapShotImages(shot));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const shot = await tx.shot.findUniqueOrThrow({ where: { id } });
    await tx.shot.delete({ where: { id } });
    await resequenceShots(tx, shot.sceneId);
  });

  return NextResponse.json({ ok: true });
}
