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
  const { id: episodeId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("VIDEO", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Video model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const claimed = await claimFinalAssembly("episode", episodeId);
  if (!claimed) {
    return NextResponse.json({ error: "A final render is already in progress for this episode." }, { status: 409 });
  }

  try {
    const video = await assembleVideo({
      parentType: "episode",
      parentId: episodeId,
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
    await releaseFinalAssembly("episode", episodeId);
  }
}
