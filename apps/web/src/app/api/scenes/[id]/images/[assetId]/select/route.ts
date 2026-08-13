import { NextRequest, NextResponse } from "next/server";
import { selectSceneImage } from "@/lib/scene-images";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  const image = await selectSceneImage(sceneId, assetId);
  return NextResponse.json(image);
}
