import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { draftAudioCuePlan } from "@/lib/audio-cue-plan";

const bodySchema = z.object({
  modelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("AUDIO_CUE_PLANNING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Audio Cue Planning model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const entries = await draftAudioCuePlan({ parentType: "story", parentId: storyId, modelId: model.modelId });
    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
