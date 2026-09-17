import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { ElevenLabsError } from "@/lib/ai/elevenlabs";
import { SarvamError } from "@/lib/ai/sarvam";
import { generateDialogueAudio, claimDialogueAudioGeneration, releaseDialogueAudioGeneration } from "@/lib/voice";

const bodySchema = z.object({
  modelId: z.string().optional(),
  // Dubbing — see scenes/[id]/narration/generate's identical field.
  language: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dialogueLineId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("VOICE", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Voice model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const claimed = await claimDialogueAudioGeneration(dialogueLineId);
  if (!claimed) {
    return NextResponse.json({ error: "Audio is already generating for this line." }, { status: 409 });
  }

  try {
    const audio = await generateDialogueAudio({ dialogueLineId, modelId: model.modelId, provider: model.provider, language: body.language });
    return NextResponse.json(audio, { status: 201 });
  } catch (error) {
    if (error instanceof ElevenLabsError || error instanceof SarvamError) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message, modelId: model.modelId, provider: model.provider }, { status: 400 });
    }
    throw error;
  } finally {
    await releaseDialogueAudioGeneration(dialogueLineId);
  }
}
