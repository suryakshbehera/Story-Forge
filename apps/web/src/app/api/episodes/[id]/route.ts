import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id },
    include: { season: { include: { project: true } } },
  });
  if (!episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }
  return NextResponse.json(episode);
}

const patchSchema = z.object({
  number: z.number().int().positive().optional(),
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const episode = await prisma.episode.update({ where: { id }, data: body });
  return NextResponse.json(episode);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.episode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
