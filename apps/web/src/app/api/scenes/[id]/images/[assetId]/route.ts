import { NextRequest, NextResponse } from "next/server";
import { deleteSceneImage } from "@/lib/scene-images";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  await deleteSceneImage(sceneId, assetId);
  return NextResponse.json({ ok: true });
}
