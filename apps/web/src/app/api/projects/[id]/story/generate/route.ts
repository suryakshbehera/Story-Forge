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

const SYSTEM_PROMPT = `You are the Story Writing engine inside Narrata, a manual-first AI story/video production studio.
Write a complete, well-structured story draft based on the Project Context and Instructions below.
Match the requested genre, tone, language, and duration. Keep locked characters and locations consistent with their descriptions.
Output only the story content itself — no headings like "Here is your story", no meta commentary.`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const story = await prisma.story.findUnique({ where: { projectId } });
  if (!story) {
    return NextResponse.json({ error: "This project has no Story (is it a Series project?)" }, { status: 400 });
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
    body.instructions?.trim() || "Write the story now."
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
    entityType: "STORY",
    entityId: story.id,
    payload: { content },
    createdBy: "AI",
    prompt: userPrompt,
    modelId: model.modelId,
    generationSettings: { temperature: 0.8 },
  });

  const updatedStory = await prisma.story.update({
    where: { projectId },
    data: { content },
  });

  return NextResponse.json({ story: updatedStory, version });
}
