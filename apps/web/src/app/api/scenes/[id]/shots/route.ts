import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SHOT_INCLUDE, mapShotImages } from "@/lib/shots";
import { CAMERA_MOVEMENTS } from "@/lib/video-model-config";

const createSchema = z.object({
  order: z.number().int().positive(),
  description: z.string().min(1),
  cameraMovement: z.enum(CAMERA_MOVEMENTS).default("STATIC"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = createSchema.parse(await req.json());

  const shot = await prisma.shot.create({
    data: {
      sceneId,
      order: body.order,
      description: body.description,
      cameraMovement: body.cameraMovement,
    },
    include: SHOT_INCLUDE,
  });

  return NextResponse.json(mapShotImages(shot), { status: 201 });
}
