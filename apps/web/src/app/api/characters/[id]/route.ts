import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

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
  appearance: z.string().optional().nullable(),
  personality: z.string().optional().nullable(),
  clothing: z.string().optional().nullable(),
  background: z.string().optional().nullable(),
  characterArc: z.string().optional().nullable(),
  isLocked: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const character = await prisma.character.update({ where: { id }, data: body });
  return NextResponse.json(character);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.character.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
