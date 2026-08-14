import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDialogueLine } from "@/lib/voice";

const bodySchema = z.object({
  characterId: z.string(),
  text: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json());
  const line = await createDialogueLine({ sceneId, ...body });
  return NextResponse.json(line, { status: 201 });
}
