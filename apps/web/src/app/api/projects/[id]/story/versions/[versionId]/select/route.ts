import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { selectVersion } from "@/lib/versioning";

interface VersionPayload {
  content: string;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: projectId, versionId } = await params;
  const story = await prisma.story.findUniqueOrThrow({ where: { projectId } });

  const version = await selectVersion("STORY", story.id, versionId);
  const payload = version.payload as unknown as VersionPayload;

  const updatedStory = await prisma.story.update({
    where: { projectId },
    data: { content: payload.content },
  });

  return NextResponse.json({ story: updatedStory, version });
}
