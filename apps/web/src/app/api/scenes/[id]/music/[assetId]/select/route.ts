import { NextRequest, NextResponse } from "next/server";
import { selectSceneMusic } from "@/lib/scene-audio";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  const music = await selectSceneMusic(sceneId, assetId);
  return NextResponse.json(music);
}
