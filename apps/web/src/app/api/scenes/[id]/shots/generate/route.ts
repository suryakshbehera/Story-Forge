import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { generateShots, ShotsExistError } from "@/lib/shots";

const bodySchema = z.object({
  modelId: z.string().optional(),
  regenerateAll: z.boolean().default(false),
});

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
    const result = await generateShots({ sceneId, modelId: model.modelId, regenerateAll: body.regenerateAll });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ShotsExistError) {
      return NextResponse.json({ error: error.message, existingCount: error.existingCount }, { status: 409 });
    }
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
