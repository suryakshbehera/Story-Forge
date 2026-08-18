import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";

const MAX_BYTES = 15 * 1024 * 1024;

// Only one cover image per project (it's a card thumbnail, not a gallery
// like styleReferences) — uploading a new one replaces the old, mirroring
// the delete-then-set pattern used for other single-slot fields in the app.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
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

  const existing = await prisma.asset.findMany({ where: { projectCoverId: projectId } });

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = buildStorageKey("project-cover", projectId, file.name);
  await storage.put(key, buffer);

  const asset = await prisma.asset.create({
    data: {
      type: "REFERENCE_IMAGE",
      storageKey: key,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      projectCoverId: projectId,
    },
  });

  for (const old of existing) {
    await storage.remove(old.storageKey);
    await prisma.asset.delete({ where: { id: old.id } });
  }

  return NextResponse.json(asset, { status: 201 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const existing = await prisma.asset.findMany({ where: { projectCoverId: projectId } });
  for (const old of existing) {
    await storage.remove(old.storageKey);
    await prisma.asset.delete({ where: { id: old.id } });
  }
  return NextResponse.json({ ok: true });
}
