import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { moveDialogueLine } from "@/lib/voice";

const bodySchema = z.object({ direction: z.enum(["up", "down"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = bodySchema.parse(await req.json());
  const lines = await moveDialogueLine(id, body.direction);
  return NextResponse.json({ lines });
}
