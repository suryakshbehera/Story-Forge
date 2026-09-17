import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeDialogueLine } from "@/lib/voice";

// Lightweight polling target for a dialogue line's own voice-generation
// claim — same reasoning as scenes/[id]/status.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const line = await prisma.dialogueLine.findUnique({
    where: { id },
    include: {
      character: { select: { id: true, name: true, voiceName: true } },
      // Dubbing — see scenes/[id]/status's identical comment: this feeds
      // the primary-language DialogueLineRow's poll loop only.
      audio: { where: { language: null }, orderBy: { createdAt: "desc" } },
      translations: true,
    },
  });
  if (!line) {
    return NextResponse.json({ error: "Dialogue line not found" }, { status: 404 });
  }
  return NextResponse.json(serializeDialogueLine(line));
}
