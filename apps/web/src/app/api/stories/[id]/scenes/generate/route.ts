import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getModelOrDefault } from "@/lib/ai/models";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { assembleContext } from "@/lib/context/assemble";
import { generateScenes, ScenesExistError } from "@/lib/scenes";

const bodySchema = z.object({
  modelId: z.string().optional(),
  instructions: z.string().optional(),
  regenerateAll: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: storyId } = await params;
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }
  if (!story.content?.trim()) {
    return NextResponse.json(
      { error: "Write or generate a Story first — Scene Engine needs the story content to break into scenes." },
      { status: 400 }
    );
  }

  const model = await getModelOrDefault("SCENE_PLANNING", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Scene Planning model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const context = await assembleContext({ projectId: story.projectId });

  try {
    const result = await generateScenes({
      projectId: story.projectId,
      parentType: "story",
      parentId: story.id,
      context,
      modelId: model.modelId,
      instructions: body.instructions,
      regenerateAll: body.regenerateAll,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ScenesExistError) {
      return NextResponse.json({ error: error.message, existingCount: error.existingCount }, { status: 409 });
    }
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
