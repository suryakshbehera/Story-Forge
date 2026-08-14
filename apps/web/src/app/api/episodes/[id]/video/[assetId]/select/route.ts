import { NextRequest, NextResponse } from "next/server";
import { selectFinalVideo } from "@/lib/video-assembly";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: episodeId, assetId } = await params;
  const video = await selectFinalVideo("episode", episodeId, assetId);
  return NextResponse.json(video);
}
