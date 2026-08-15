import { NextRequest, NextResponse } from "next/server";
import { deleteSceneMusic } from "@/lib/scene-audio";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  await deleteSceneMusic(sceneId, assetId);
  return NextResponse.json({ ok: true });
}
