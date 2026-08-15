import { NextRequest, NextResponse } from "next/server";
import { selectSceneSfx } from "@/lib/scene-audio";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  const sfx = await selectSceneSfx(sceneId, assetId);
  return NextResponse.json(sfx);
}
