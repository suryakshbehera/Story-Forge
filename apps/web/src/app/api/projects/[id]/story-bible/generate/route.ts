import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getModelOrDefault } from "@/lib/ai/models";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { assembleContext } from "@/lib/context/assemble";
import { createVersion } from "@/lib/versioning";

const bodySchema = z.object({
  modelId: z.string().optional(),
  instructions: z.string().optional(),
});

const SYSTEM_PROMPT = `You are the Story Bible engine inside Narrata, a manual-first AI story/video production studio.
Write a complete Story Bible for a multi-season series based on the Project Context and Instructions below: world rules,
tone, the overall premise, and how the world/characters/locations fit together. Keep locked characters and locations
consistent with their descriptions. Output only the Story Bible content itself — no meta commentary.`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const storyBible = await prisma.storyBible.findUnique({ where: { projectId } });
  if (!storyBible) {
    return NextResponse.json(
      { error: "This project has no Story Bible (is it a Single Video project?)" },
      { status: 400 }
    );
  }

  const model = await getModelOrDefault("STORY_WRITING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Story Writing model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const projectContext = await assembleContext({ projectId });
  const userPrompt = `# Project Context\n${projectContext}\n\n# Instructions\n${
    body.instructions?.trim() || "Write the Story Bible now."
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
    entityType: "STORY_BIBLE",
    entityId: storyBible.id,
    payload: { content },
    createdBy: "AI",
    prompt: userPrompt,
    modelId: model.modelId,
    generationSettings: { temperature: 0.8 },
  });

  const updated = await prisma.storyBible.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ storyBible: updated, version });
}
