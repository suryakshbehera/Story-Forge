import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { ElevenLabsError } from "@/lib/ai/elevenlabs";
import { generateDialogueAudio } from "@/lib/voice";

const bodySchema = z.object({
  modelId: z.string().optional(),
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

  try {
    const audio = await generateDialogueAudio({ dialogueLineId, modelId: model.modelId });
    return NextResponse.json(audio, { status: 201 });
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
