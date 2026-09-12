import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { ElevenLabsError } from "@/lib/ai/elevenlabs";
import { generateSceneMusic, claimMusicGeneration, releaseMusicGeneration } from "@/lib/scene-audio";

const bodySchema = z.object({
  modelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("MUSIC_GENERATION", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Music Generation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const claimed = await claimMusicGeneration(sceneId);
  if (!claimed) {
    return NextResponse.json({ error: "Music is already generating for this scene." }, { status: 409 });
  }

  try {
    const music = await generateSceneMusic({ sceneId, modelId: model.modelId, provider: model.provider });
    return NextResponse.json(music, { status: 201 });
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 400 });
    }
    throw error;
  } finally {
    await releaseMusicGeneration(sceneId);
  }
}
