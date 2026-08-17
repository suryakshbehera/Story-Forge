import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getModelOrDefault } from "@/lib/ai/models";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { assembleContext } from "@/lib/context/assemble";
import { createVersion } from "@/lib/versioning";
import { getOrCreateBlueprint, NotSeriesProjectError } from "@/lib/blueprint";

const bodySchema = z.object({
  modelId: z.string().optional(),
  instructions: z.string().optional(),
});

const SYSTEM_PROMPT = `You are the Series Blueprint engine inside Narrata, a manual-first AI story/video production studio.
Draft the Series Blueprint based on the Project Context and Instructions below: the format shape new episodes should be
drafted against — typical act structure, typical scene/shot counts, typical runtime, and tone of the format itself (as
distinct from the story's own tone). Output only the Blueprint content itself — no meta commentary.`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  let blueprint;
  try {
    blueprint = await getOrCreateBlueprint(projectId);
  } catch (error) {
    if (error instanceof NotSeriesProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const model = await getModelOrDefault("BLUEPRINT_PLANNING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Blueprint Planning model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const projectContext = await assembleContext({ projectId });
  const userPrompt = `# Project Context\n${projectContext}\n\n# Instructions\n${
    body.instructions?.trim() || "Draft the Series Blueprint now."
  }`;

  let content: string;
  try {
    content = await callChatModel({
      modelId: model.modelId,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }

  const version = await createVersion({
    entityType: "SERIES_BLUEPRINT",
    entityId: blueprint.id,
    payload: { content },
    createdBy: "AI",
    prompt: userPrompt,
    modelId: model.modelId,
    generationSettings: { temperature: 0.8 },
  });

  const updated = await prisma.seriesBlueprint.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ blueprint: updated, version });
}
