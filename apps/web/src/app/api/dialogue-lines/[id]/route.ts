import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateDialogueLine, deleteDialogueLine } from "@/lib/voice";

const patchSchema = z.object({
  characterId: z.string().optional(),
  text: z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const line = await updateDialogueLine(id, body);
  return NextResponse.json(line);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteDialogueLine(id);
  return NextResponse.json({ ok: true });
}
