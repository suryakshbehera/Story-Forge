import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapFinalVideos, mapSilentVideos } from "@/lib/video-assembly";

// Lightweight polling target for the story-level assembly claims (silent +
// final) — same reasoning as scenes/[id]/status: only what a 5s poll loop
// actually needs, not the full page-level include.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      finalVideos: { orderBy: { createdAt: "desc" } },
      silentVideos: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }
  const mapped = mapFinalVideos(mapSilentVideos(story));
  return NextResponse.json(mapped);
}
