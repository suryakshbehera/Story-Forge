import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { setVoiceForLanguage } from "@/lib/localization";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      story: true,
      storyBible: true,
      seasons: { orderBy: { number: "asc" }, include: { episodes: { orderBy: { number: "asc" } } } },
      characters: { orderBy: { name: "asc" } },
      locations: { orderBy: { name: "asc" } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  narratorVoiceName: z.string().optional().nullable(),
  // Dubbing — see characters/[id]'s identical field, for the one
  // project-wide narrator voice instead of a per-character one.
  narratorVoiceForLanguage: z.object({ language: z.string(), voiceId: z.string().nullable() }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { narratorVoiceForLanguage, ...body } = patchSchema.parse(await req.json());

  if (narratorVoiceForLanguage) {
    await setVoiceForLanguage("project", id, narratorVoiceForLanguage.language, narratorVoiceForLanguage.voiceId);
  }

  const project =
    Object.keys(body).length > 0
      ? await prisma.project.update({ where: { id }, data: body })
      : await prisma.project.findUniqueOrThrow({ where: { id } });

  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
