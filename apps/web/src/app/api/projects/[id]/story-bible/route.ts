import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  premise: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  tone: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  worldRules: z.string().optional().nullable(),
  visualStyle: z.string().optional().nullable(),
  timelineNotes: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const storyBible = await prisma.storyBible.update({
    where: { projectId: id },
    data: body,
  });

  return NextResponse.json(storyBible);
}
