import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateSceneVideo } from "@/lib/scene-video";
import { parseVideoModelConfig } from "@/lib/video-model-config";

const bodySchema = z.object({
  modelId: z.string().optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("VIDEO_GENERATION", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Video Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const clips = await generateSceneVideo({
      sceneId,
      modelId: model.modelId,
      modelConfig: parseVideoModelConfig(model.config),
      resolution: body.resolution,
      generateAudio: body.generateAudio,
    });
    return NextResponse.json(clips, { status: 201 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
