import { NextRequest, NextResponse } from "next/server";
import { selectDialogueAudio, deleteDialogueAudio } from "@/lib/voice";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: dialogueLineId, assetId } = await params;
  const audio = await selectDialogueAudio(dialogueLineId, assetId);
  return NextResponse.json(audio);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: dialogueLineId, assetId } = await params;
  await deleteDialogueAudio(dialogueLineId, assetId);
  return NextResponse.json({ ok: true });
}
