import { NextRequest, NextResponse } from "next/server";
import { deleteShotImage } from "@/lib/shot-images";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: shotId, assetId } = await params;
  await deleteShotImage(shotId, assetId);
  return NextResponse.json({ ok: true });
}
