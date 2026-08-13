import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { assetId } = await params;
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
  return NextResponse.json({ ok: true });
}
