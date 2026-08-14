import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapSceneImages } from "@/lib/scenes";

const createSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().optional().nullable(),
  description: z.string().min(1),
  visualMode: z.enum(["ILLUSTRATION", "IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"]).default("ILLUSTRATION"),
  visualModeReason: z.string().optional().nullable(),
  characterIds: z.array(z.string()).default([]),
  locationIds: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params;
  const body = createSchema.parse(await req.json());

  const scene = await prisma.scene.create({
    data: {
      storyId,
      order: body.order,
      title: body.title,
      description: body.description,
      visualMode: body.visualMode,
      visualModeReason: body.visualModeReason,
      characters: { connect: body.characterIds.map((id) => ({ id })) },
      locations: { connect: body.locationIds.map((id) => ({ id })) },
    },
    include: SCENE_INCLUDE,
  });

  return NextResponse.json(mapSceneImages(scene), { status: 201 });
}
