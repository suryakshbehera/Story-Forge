import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateDialogueLineTranslation } from "@/lib/localization";

// Manual edit of one dialogue line's translation into one dub language —
// see scenes/[id]/translation/route.ts's identical narration-side route.
const patchSchema = z.object({
  language: z.string().min(1),
  text: z.string().optional(),
  deliveryNotes: z.string().optional().nullable(),
  speed: z.number().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dialogueLineId } = await params;
  const { language, ...fields } = patchSchema.parse(await req.json());
  const translation = await updateDialogueLineTranslation(dialogueLineId, language, fields);
  return NextResponse.json(translation);
}
