import { NextRequest, NextResponse } from "next/server";
import { deleteFinalVideo } from "@/lib/video-assembly";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: episodeId, assetId } = await params;
  await deleteFinalVideo("episode", episodeId, assetId);
  return NextResponse.json({ ok: true });
}
