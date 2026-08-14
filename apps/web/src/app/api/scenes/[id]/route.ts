import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, resequenceScenes, mapSceneImages } from "@/lib/scenes";

const patchSchema = z.object({
  title: z.string().optional().nullable(),
  description: z.string().min(1).optional(),
  visualMode: z.enum(["ILLUSTRATION", "IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"]).optional(),
  visualModeReason: z.string().optional().nullable(),
  narration: z.string().optional().nullable(),
  motionPrompt: z.string().optional().nullable(),
  videoPrompt: z.string().optional().nullable(),
  videoDurationSeconds: z.number().int().positive().optional().nullable(),
  characterIds: z.array(z.string()).optional(),
  locationIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const { characterIds, locationIds, ...scalarFields } = body;

  const scene = await prisma.scene.update({
    where: { id },
    data: {
      ...scalarFields,
      ...(characterIds !== undefined ? { characters: { set: characterIds.map((id) => ({ id })) } } : {}),
      ...(locationIds !== undefined ? { locations: { set: locationIds.map((id) => ({ id })) } } : {}),
    },
    include: SCENE_INCLUDE,
  });

  return NextResponse.json(mapSceneImages(scene));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const scene = await tx.scene.findUniqueOrThrow({ where: { id } });
    await tx.scene.delete({ where: { id } });
    await resequenceScenes(tx, scene.storyId ? { storyId: scene.storyId } : { episodeId: scene.episodeId! });
  });

  return NextResponse.json({ ok: true });
}
