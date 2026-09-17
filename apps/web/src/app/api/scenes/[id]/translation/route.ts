import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateSceneTranslation } from "@/lib/localization";

// Manual edit of one scene's translation into one dub language — the same
// "AI proposes, user can overwrite" idiom as every other AI-drafted field in
// this app, one level over (see translation/generate/route.ts for the draft
// step).
const patchSchema = z.object({
  language: z.string().min(1),
  narration: z.string().optional().nullable(),
  narrationDeliveryNotes: z.string().optional().nullable(),
  narrationSpeed: z.number().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const { language, ...fields } = patchSchema.parse(await req.json());
  const translation = await updateSceneTranslation(sceneId, language, fields);
  return NextResponse.json(translation);
}
