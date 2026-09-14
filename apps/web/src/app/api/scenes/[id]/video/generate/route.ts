import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateSceneVideo, claimSceneVideoGeneration, releaseSceneVideoGeneration } from "@/lib/scene-video";
import { parseVideoModelConfig } from "@/lib/video-model-config";

const bodySchema = z.object({
  modelId: z.string().optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  includeCastReferences: z.boolean().optional(),
  validationModelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const [model, validationModel] = await Promise.all([
    getModelOrDefault("VIDEO_GENERATION", body.modelId),
    getModelOrDefault("VIDEO_VALIDATION", body.validationModelId),
  ]);
  if (!model) {
    return NextResponse.json(
      { error: "No Video Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const claimed = await claimSceneVideoGeneration(sceneId);
  if (!claimed) {
    return NextResponse.json(
      { error: "Video generation is already in progress for this scene." },
      { status: 409 }
    );
  }

  try {
    const clips = await generateSceneVideo({
      sceneId,
      modelId: model.modelId,
      modelConfig: parseVideoModelConfig(model.config),
      resolution: body.resolution,
      generateAudio: body.generateAudio,
      includeCastReferences: body.includeCastReferences,
      // Advisory-only — an unconfigured model just skips the check.
      validationModelId: validationModel?.modelId ?? null,
    });
    return NextResponse.json(clips, { status: 201 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 502 });
    }
    throw error;
  } finally {
    await releaseSceneVideoGeneration(sceneId);
  }
}
