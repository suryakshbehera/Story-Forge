import { NextRequest, NextResponse } from "next/server";
import { getMouthFrameStatus } from "@/lib/mouth-flap";

// Whether this scene can use the 2D mouth flap and how many of its speaking
// shots already have their open-mouth frame — read by the scene voice panel.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  return NextResponse.json(await getMouthFrameStatus(sceneId));
}
