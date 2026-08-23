import { NextRequest, NextResponse } from "next/server";
import { selectSilentVideo } from "@/lib/video-assembly";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: storyId, assetId } = await params;
  const silentVideo = await selectSilentVideo("story", storyId, assetId);
  return NextResponse.json(silentVideo);
}
