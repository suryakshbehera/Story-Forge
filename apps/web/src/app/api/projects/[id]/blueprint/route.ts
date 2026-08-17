import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getOrCreateBlueprint, NotSeriesProjectError } from "@/lib/blueprint";

const patchSchema = z.object({
  actStructure: z.string().optional().nullable(),
  sceneShotGuidance: z.string().optional().nullable(),
  runtimeTarget: z.string().optional().nullable(),
  tone: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = patchSchema.parse(await req.json());

  try {
    await getOrCreateBlueprint(projectId);
  } catch (error) {
    if (error instanceof NotSeriesProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const blueprint = await prisma.seriesBlueprint.update({
    where: { projectId },
    data: body,
  });

  return NextResponse.json(blueprint);
}
