import { NextRequest, NextResponse } from "next/server";
import { deleteFinalVideo } from "@/lib/video-assembly";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: storyId, assetId } = await params;
  await deleteFinalVideo("story", storyId, assetId);
  return NextResponse.json({ ok: true });
}
