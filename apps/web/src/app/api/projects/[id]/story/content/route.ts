import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createVersion } from "@/lib/versioning";

const bodySchema = z.object({
  content: z.string(),
});

// Manual edits are versioned too, same as AI generations — just tagged
// createdBy: "USER" instead of "AI".
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { content } = bodySchema.parse(await req.json());

  const story = await prisma.story.findUniqueOrThrow({ where: { projectId } });

  const version = await createVersion({
    entityType: "STORY",
    entityId: story.id,
    payload: { content },
    createdBy: "USER",
  });

  const updatedStory = await prisma.story.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ story: updatedStory, version });
}
