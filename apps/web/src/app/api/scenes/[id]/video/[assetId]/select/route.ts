import { NextRequest, NextResponse } from "next/server";
import { selectSceneVideoClip } from "@/lib/scene-video";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  const clip = await selectSceneVideoClip(sceneId, assetId);
  return NextResponse.json(clip);
}
