import { NextRequest, NextResponse } from "next/server";
import { deleteSceneVideoClip } from "@/lib/scene-video";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  await deleteSceneVideoClip(sceneId, assetId);
  return NextResponse.json({ ok: true });
}
