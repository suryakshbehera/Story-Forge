import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapFinalVideos, mapSilentVideos } from "@/lib/video-assembly";

// Same reasoning as stories/[id]/status — episode-side equivalent.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id },
    include: {
      finalVideos: { orderBy: { createdAt: "desc" } },
      silentVideos: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }
  const mapped = mapFinalVideos(mapSilentVideos(episode));
  return NextResponse.json(mapped);
}
