import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyAudioMixingPlan } from "@/lib/audio-mixing-plan";

// Shape only — the actual range clamping lives in applyAudioMixingPlan, so
// an out-of-range number from an edited panel is corrected rather than
// 400'ing the whole plan.
const bodySchema = z.object({
  entries: z.array(
    z.object({
      sceneId: z.string(),
      musicVolume: z.number(),
      sfxVolume: z.number(),
      duckMusicUnderDialogue: z.boolean(),
      musicFadeInSeconds: z.number().nullable(),
      musicFadeOutSeconds: z.number().nullable(),
    })
  ),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: episodeId } = await params;
  const body = bodySchema.parse(await req.json());

  try {
    await applyAudioMixingPlan("episode", episodeId, body.entries);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
