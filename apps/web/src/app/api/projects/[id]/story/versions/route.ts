import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const story = await prisma.story.findUniqueOrThrow({ where: { projectId } });
  const versions = await listVersions("STORY", story.id);
  return NextResponse.json(versions);
}
