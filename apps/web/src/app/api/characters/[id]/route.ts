import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { setVoiceForLanguage } from "@/lib/localization";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const character = await prisma.character.findUnique({
    where: { id },
    include: { referenceImages: true },
  });
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }
  return NextResponse.json(character);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  identity: z.string().optional().nullable(),
  age: z.string().optional().nullable(),
  appearance: z.string().optional().nullable(),
  personality: z.string().optional().nullable(),
  clothing: z.string().optional().nullable(),
  background: z.string().optional().nullable(),
  characterArc: z.string().optional().nullable(),
  isLocked: z.boolean().optional(),
  voiceName: z.string().optional().nullable(),
  // Dubbing — sets (or clears, if voiceId is null) just this one language's
  // entry in Character.voicesByLanguage, as an atomic UPDATE (see
  // lib/localization.ts's setVoiceForLanguage) so setting one dub
  // language's voice can't clobber another's saved in a concurrent request.
  voiceForLanguage: z.object({ language: z.string(), voiceId: z.string().nullable() }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { voiceForLanguage, ...body } = patchSchema.parse(await req.json());

  if (voiceForLanguage) {
    await setVoiceForLanguage("character", id, voiceForLanguage.language, voiceForLanguage.voiceId);
  }

  const character =
    Object.keys(body).length > 0
      ? await prisma.character.update({ where: { id }, data: body })
      : await prisma.character.findUniqueOrThrow({ where: { id } });
  return NextResponse.json(character);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.character.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
