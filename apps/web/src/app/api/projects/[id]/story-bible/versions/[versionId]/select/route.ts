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
  const storyBible = await prisma.storyBible.findUniqueOrThrow({ where: { projectId } });

  const version = await selectVersion("STORY_BIBLE", storyBible.id, versionId);
  const payload = version.payload as unknown as VersionPayload;

  const updated = await prisma.storyBible.update({
    where: { projectId },
    data: { content: payload.content },
  });

  return NextResponse.json({ storyBible: updated, version });
}
