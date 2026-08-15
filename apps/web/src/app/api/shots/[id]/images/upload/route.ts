import { NextRequest, NextResponse } from "next/server";
import { uploadShotImage } from "@/lib/shot-images";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: shotId } = await params;
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
  const image = await uploadShotImage(shotId, buffer, file.name, file.type);

  return NextResponse.json(image, { status: 201 });
}
