import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = createSchema.parse(await req.json());

  const season = await prisma.season.create({
    data: { projectId, number: body.number, title: body.title },
  });

  return NextResponse.json(season, { status: 201 });
}
