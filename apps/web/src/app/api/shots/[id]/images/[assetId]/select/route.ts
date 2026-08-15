import { NextRequest, NextResponse } from "next/server";
import { selectShotImage } from "@/lib/shot-images";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: shotId, assetId } = await params;
  const image = await selectShotImage(shotId, assetId);
  return NextResponse.json(image);
}
