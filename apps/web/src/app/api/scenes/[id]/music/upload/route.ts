import { NextRequest, NextResponse } from "next/server";
import { uploadSceneMusic } from "@/lib/scene-audio";

const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!file.type.startsWith("audio/")) {
    return NextResponse.json({ error: "Only audio files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Audio must be under 30MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const music = await uploadSceneMusic(sceneId, buffer, file.name, file.type);

  return NextResponse.json(music, { status: 201 });
}
