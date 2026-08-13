import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 15MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = buildStorageKey("characters", characterId, file.name);
  await storage.put(key, buffer);

  const asset = await prisma.asset.create({
    data: {
      type: "REFERENCE_IMAGE",
      storageKey: key,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      characterId,
    },
  });

  return NextResponse.json(asset, { status: 201 });
}
