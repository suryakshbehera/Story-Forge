import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, parentWhere, mapScenesImages } from "@/lib/scenes";

const bodySchema = z.object({
  direction: z.enum(["up", "down"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = bodySchema.parse(await req.json());

  const result = await prisma.$transaction(async (tx) => {
    const scene = await tx.scene.findUniqueOrThrow({ where: { id } });
    const where = scene.storyId ? parentWhere("story", scene.storyId) : parentWhere("episode", scene.episodeId!);
    const neighborOrder = body.direction === "up" ? scene.order - 1 : scene.order + 1;
    const neighbor = await tx.scene.findFirst({ where: { ...where, order: neighborOrder } });

    if (!neighbor) {
      const full = await tx.scene.findUniqueOrThrow({ where: { id: scene.id }, include: SCENE_INCLUDE });
      return { scenes: [full] };
    }

    // Per-statement unique constraint isn't deferred — swap through a
    // sentinel order to avoid a transient collision on (parent, order).
    await tx.scene.update({ where: { id: scene.id }, data: { order: -1 } });
    await tx.scene.update({ where: { id: neighbor.id }, data: { order: scene.order } });
    const updatedScene = await tx.scene.update({
      where: { id: scene.id },
      data: { order: neighbor.order },
      include: SCENE_INCLUDE,
    });
    const updatedNeighbor = await tx.scene.findUniqueOrThrow({ where: { id: neighbor.id }, include: SCENE_INCLUDE });

    return { scenes: [updatedScene, updatedNeighbor] };
  });

  return NextResponse.json({ scenes: mapScenesImages(result.scenes) });
}
