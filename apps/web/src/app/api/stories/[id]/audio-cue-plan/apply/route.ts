import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyAudioCuePlan } from "@/lib/audio-cue-plan";

const bodySchema = z.object({
  entries: z.array(
    z.object({
      sceneId: z.string(),
      narration: z.string(),
      dialogueLines: z.array(z.object({ characterName: z.string(), text: z.string() })),
      musicPrompt: z.string(),
      sfxPrompt: z.string(),
    })
  ),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params;
  const body = bodySchema.parse(await req.json());

  try {
    await applyAudioCuePlan("story", storyId, body.entries);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
