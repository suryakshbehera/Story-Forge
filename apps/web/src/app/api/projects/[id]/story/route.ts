import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  topic: z.string().optional().nullable(),
  premise: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  tone: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  duration: z.string().optional().nullable(),
  narrationStyle: z.string().optional().nullable(),
  openingStyle: z.string().optional().nullable(),
  closingStyle: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const story = await prisma.story.update({
    where: { projectId: id },
    data: body,
  });

  return NextResponse.json(story);
}
