import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createVersion } from "@/lib/versioning";

const bodySchema = z.object({
  content: z.string(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { content } = bodySchema.parse(await req.json());

  const storyBible = await prisma.storyBible.findUniqueOrThrow({ where: { projectId } });

  const version = await createVersion({
    entityType: "STORY_BIBLE",
    entityId: storyBible.id,
    payload: { content },
    createdBy: "USER",
  });

  const updated = await prisma.storyBible.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ storyBible: updated, version });
}
