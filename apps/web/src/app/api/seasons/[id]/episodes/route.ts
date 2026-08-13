import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seasonId } = await params;
  const body = createSchema.parse(await req.json());

  const episode = await prisma.episode.create({
    data: { seasonId, number: body.number, title: body.title, summary: body.summary },
  });

  return NextResponse.json(episode, { status: 201 });
}
