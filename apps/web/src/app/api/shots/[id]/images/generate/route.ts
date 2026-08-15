import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateShotImage } from "@/lib/shot-images";

const bodySchema = z.object({
  promptModelId: z.string().optional(),
  imageModelId: z.string().optional(),
  validationModelId: z.string().optional(),
  instructions: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: shotId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const [promptModel, imageModel, validationModel] = await Promise.all([
    getModelOrDefault("IMAGE_PROMPTS", body.promptModelId),
    getModelOrDefault("IMAGE_GENERATION", body.imageModelId),
    getModelOrDefault("IMAGE_VALIDATION", body.validationModelId),
  ]);

  if (!promptModel) {
    return NextResponse.json(
      { error: "No Image Prompt model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }
  if (!imageModel) {
    return NextResponse.json(
      { error: "No Image Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const result = await generateShotImage({
      shotId,
      promptModelId: promptModel.modelId,
      imageModelId: imageModel.modelId,
      // Validation is advisory-only — an unconfigured model just skips it.
      validationModelId: validationModel?.modelId ?? null,
      instructions: body.instructions,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
