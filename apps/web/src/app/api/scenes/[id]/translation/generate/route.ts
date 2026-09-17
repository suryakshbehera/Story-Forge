import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { translateSceneScript } from "@/lib/localization";

const bodySchema = z.object({
  language: z.string().min(1),
  modelId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await params;
  const body = bodySchema.parse(await req.json());

  const model = await getModelOrDefault("TRANSLATION", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Translation model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  try {
    const result = await translateSceneScript({ sceneId, language: body.language, modelId: model.modelId });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
