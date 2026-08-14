import { NextRequest, NextResponse } from "next/server";
import { selectNarrationAudio, deleteNarrationAudio } from "@/lib/voice";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  const audio = await selectNarrationAudio(sceneId, assetId);
  return NextResponse.json(audio);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: sceneId, assetId } = await params;
  await deleteNarrationAudio(sceneId, assetId);
  return NextResponse.json({ ok: true });
}
