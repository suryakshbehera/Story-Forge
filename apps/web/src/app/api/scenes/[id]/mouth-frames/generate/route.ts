import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateMouthOpenFrames, getMouthFrameStatus } from "@/lib/mouth-flap";

const bodySchema = z.object({
  imageModelId: z.string().optional(),
  // Regenerate twins that already exist (e.g. after an unhappy first result).
  force: z.boolean().default(false),
});

// Generates the "open mouth" twin for every speaking shot in the scene — the
// picture half of the 2D mouth flap (see lib/mouth-flap.ts). Reuses the
// IMAGE_GENERATION model slot: it is the same image-to-image call the shot
// images use, just with a fixed edit instruction.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const imageModel = await getModelOrDefault("IMAGE_GENERATION", body.imageModelId);
  if (!imageModel) {
    return NextResponse.json(
      { error: "No Image Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const result = await generateMouthOpenFrames({ sceneId, imageModelId: imageModel.modelId, force: body.force });
    const status = await getMouthFrameStatus(sceneId);
    return NextResponse.json({ ...result, status }, { status: result.failed.length > 0 && result.generated === 0 && result.skipped === 0 ? 502 : 200 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
