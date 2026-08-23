import { NextRequest, NextResponse } from "next/server";
import { deleteSilentVideo } from "@/lib/video-assembly";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: episodeId, assetId } = await params;
  await deleteSilentVideo("episode", episodeId, assetId);
  return NextResponse.json({ ok: true });
}
