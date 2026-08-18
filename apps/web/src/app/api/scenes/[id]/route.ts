import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, resequenceScenes, mapSceneShots } from "@/lib/scenes";

const patchSchema = z.object({
  title: z.string().optional().nullable(),
  description: z.string().min(1).optional(),
  visualMode: z.enum(["ILLUSTRATION", "IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"]).optional(),
  visualModeReason: z.string().optional().nullable(),
  cameraMovement: z
    .enum(["STATIC", "ZOOM_IN", "ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "PAN_DOWN"])
    .optional(),
  narration: z.string().optional().nullable(),
  narrationDeliveryNotes: z.string().optional().nullable(),
  narrationSpeed: z.number().min(0.25).max(4).optional().nullable(),
  motionPrompt: z.string().optional().nullable(),
  videoPrompt: z.string().optional().nullable(),
  videoDurationSeconds: z.number().int().positive().optional().nullable(),
  musicPrompt: z.string().optional().nullable(),
  sfxPrompt: z.string().optional().nullable(),
  musicVolume: z.number().min(0).max(1).optional(),
  sfxVolume: z.number().min(0).max(1).optional(),
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

  return NextResponse.json(mapSceneShots(scene));
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
