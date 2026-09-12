import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { assembleVideo, claimFinalAssembly, releaseFinalAssembly } from "@/lib/video-assembly";
import { FfmpegError } from "@/lib/ffmpeg";

const bodySchema = z.object({
  modelId: z.string().optional(),
  includeClipAudio: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("VIDEO", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Video model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const claimed = await claimFinalAssembly("story", storyId);
  if (!claimed) {
    return NextResponse.json({ error: "A final render is already in progress for this story." }, { status: 409 });
  }

  try {
    const video = await assembleVideo({
      parentType: "story",
      parentId: storyId,
      modelId: model.modelId,
      includeClipAudio: body.includeClipAudio,
    });
    return NextResponse.json(video, { status: 201 });
  } catch (error) {
    if (error instanceof FfmpegError) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 500 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 400 });
    }
    throw error;
  } finally {
    await releaseFinalAssembly("story", storyId);
  }
}
