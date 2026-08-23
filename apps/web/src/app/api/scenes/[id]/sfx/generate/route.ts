import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { ElevenLabsError } from "@/lib/ai/elevenlabs";
import { generateSceneSfx } from "@/lib/scene-audio";

const bodySchema = z.object({
  modelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("SFX_GENERATION", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No SFX Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const sfx = await generateSceneSfx({ sceneId, modelId: model.modelId, provider: model.provider });
    return NextResponse.json(sfx, { status: 201 });
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
