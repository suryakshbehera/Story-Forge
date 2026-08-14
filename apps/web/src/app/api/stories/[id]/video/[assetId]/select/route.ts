import { NextRequest, NextResponse } from "next/server";
import { selectFinalVideo } from "@/lib/video-assembly";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: storyId, assetId } = await params;
  const video = await selectFinalVideo("story", storyId, assetId);
  return NextResponse.json(video);
}
