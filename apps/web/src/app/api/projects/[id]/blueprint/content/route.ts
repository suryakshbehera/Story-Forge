import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createVersion } from "@/lib/versioning";
import { getOrCreateBlueprint, NotSeriesProjectError } from "@/lib/blueprint";

const bodySchema = z.object({
  content: z.string(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { content } = bodySchema.parse(await req.json());

  let blueprint;
  try {
    blueprint = await getOrCreateBlueprint(projectId);
  } catch (error) {
    if (error instanceof NotSeriesProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const version = await createVersion({
    entityType: "SERIES_BLUEPRINT",
    entityId: blueprint.id,
    payload: { content },
    createdBy: "USER",
  });

  const updated = await prisma.seriesBlueprint.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ blueprint: updated, version });
}
