import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { regenerateScenePairVideo, claimSceneVideoGeneration, releaseSceneVideoGeneration } from "@/lib/scene-video";
import { parseVideoModelConfig } from "@/lib/video-model-config";

const bodySchema = z.object({
  modelId: z.string().optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  includeCastReferences: z.boolean().optional(),
  validationModelId: z.string().optional(),
});

// Retakes one shot pair within the scene's currently selected take instead
// of regenerating the whole scene — see regenerateScenePairVideo. Shares the
// same scene-level generation lock as full-scene generate (below) so the two
// can't race and corrupt the same batch's segment ordering.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pairIndex: string }> }
) {
  const { id: sceneId, pairIndex: pairIndexParam } = await params;
  const pairIndex = Number(pairIndexParam);
  if (!Number.isInteger(pairIndex) || pairIndex < 0) {
    return NextResponse.json({ error: "Invalid shot pair index." }, { status: 400 });
  }

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
    const clips = await regenerateScenePairVideo({
      sceneId,
      pairIndex,
      modelId: model.modelId,
      modelConfig: parseVideoModelConfig(model.config),
      resolution: body.resolution,
      generateAudio: body.generateAudio,
      includeCastReferences: body.includeCastReferences,
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
