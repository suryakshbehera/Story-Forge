import { NextRequest, NextResponse } from "next/server";
import { getSceneVoiceDurationSeconds } from "@/lib/scene-audio";

// Backs the video panel's segment-count suggestion (see scene-video-panel.tsx)
// — the same real, ffprobe'd narration+dialogue length already used to hint
// music/sfx generation length (see scene-audio.ts), not an estimate.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const seconds = await getSceneVoiceDurationSeconds(sceneId);
  return NextResponse.json({ seconds });
}
