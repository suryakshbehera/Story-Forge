import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateAudioPlan } from "@/lib/scene-audio";

const bodySchema = z.object({
  modelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("AUDIO_PLANNING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Audio Planning model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const plan = await generateAudioPlan({ sceneId, modelId: model.modelId });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
