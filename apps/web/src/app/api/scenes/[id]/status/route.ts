import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapSceneVoiceData } from "@/lib/voice";
import { mapSceneVideoData } from "@/lib/scene-video";
import { mapSceneAudioData } from "@/lib/scene-audio";

// Lightweight polling target for the scene-level generation claims
// (narration, video, music, sfx) — deliberately not the full SCENE_INCLUDE
// used by the scenes page (which also pulls in shots/images), since a panel
// polling every 5s while a job is in flight only needs its own slot's
// claim timestamp and take list.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scene = await prisma.scene.findUnique({
    where: { id },
    include: {
      narrationAudio: { orderBy: { createdAt: "desc" } },
      dialogueLines: {
        orderBy: { order: "asc" },
        include: { character: { select: { id: true, name: true, voiceName: true } }, audio: { orderBy: { createdAt: "desc" } } },
      },
      videoClips: { orderBy: { createdAt: "desc" } },
      music: { orderBy: { createdAt: "desc" } },
      sfx: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!scene) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }
  const mapped = mapSceneAudioData(mapSceneVideoData(mapSceneVoiceData(scene)));
  return NextResponse.json(mapped);
}
