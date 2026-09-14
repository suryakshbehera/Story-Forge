import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { directExistingShots, NoShotsToDirectError } from "@/lib/shots";

const bodySchema = z.object({
  modelId: z.string().optional(),
});

// Backfill/re-direct pass for an existing shot list — fills only the nine
// cinematography columns, never touches descriptions, continuity, durations
// or images. Shares SHOT_PLANNING's job type and model (same skill, and a new
// AiJobType costs two hardcoded-list edits: the Prisma enum and
// ai-models-manager.tsx's JOB_TYPES/JOB_LABELS).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const model = await getModelOrDefault("SHOT_PLANNING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Shot Planning model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const result = await directExistingShots({ sceneId, modelId: model.modelId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NoShotsToDirectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
