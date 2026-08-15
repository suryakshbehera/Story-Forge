import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SHOT_INCLUDE, mapShotImages } from "@/lib/shots";

const bodySchema = z.object({
  direction: z.enum(["up", "down"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = bodySchema.parse(await req.json());

  const result = await prisma.$transaction(async (tx) => {
    const shot = await tx.shot.findUniqueOrThrow({ where: { id } });
    const neighborOrder = body.direction === "up" ? shot.order - 1 : shot.order + 1;
    const neighbor = await tx.shot.findFirst({ where: { sceneId: shot.sceneId, order: neighborOrder } });

    if (!neighbor) {
      const full = await tx.shot.findUniqueOrThrow({ where: { id: shot.id }, include: SHOT_INCLUDE });
      return { shots: [full] };
    }

    // Per-statement unique constraint isn't deferred — swap through a
    // sentinel order to avoid a transient collision on (sceneId, order).
    await tx.shot.update({ where: { id: shot.id }, data: { order: -1 } });
    await tx.shot.update({ where: { id: neighbor.id }, data: { order: shot.order } });
    const updatedShot = await tx.shot.update({
      where: { id: shot.id },
      data: { order: neighbor.order },
      include: SHOT_INCLUDE,
    });
    const updatedNeighbor = await tx.shot.findUniqueOrThrow({ where: { id: neighbor.id }, include: SHOT_INCLUDE });

    return { shots: [updatedShot, updatedNeighbor] };
  });

  return NextResponse.json({ shots: result.shots.map(mapShotImages) });
}
