import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const storyBible = await prisma.storyBible.findUniqueOrThrow({ where: { projectId } });
  const versions = await listVersions("STORY_BIBLE", storyBible.id);
  return NextResponse.json(versions);
}
