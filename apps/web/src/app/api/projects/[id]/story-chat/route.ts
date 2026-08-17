import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOrDefault } from "@/lib/ai/models";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { assembleContext } from "@/lib/context/assemble";

const bodySchema = z.object({
  modelId: z.string().optional(),
  episodeId: z.string().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  message: z.string().min(1),
});

const SYSTEM_PROMPT = `You are the Story Chat assistant inside Narrata, a manual-first AI story/video production studio.
Converse with the producer about the Story/Episode described in the Project Context below — brainstorm, critique, rewrite dialogue or narration they paste in, answer continuity questions.
Keep locked characters and locations consistent with their descriptions. Stay conversational; you are not drafting the final document, just proposing and discussing — the producer decides what (if anything) gets applied.`;

// Chat history is not persisted server-side — the client resends it each
// turn (see story-chat-panel.tsx). Applying a reply to the actual Story
// content or Episode summary goes through the existing PATCH
// /api/projects/[id]/story/content or PATCH /api/episodes/[id] routes,
// not this one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = bodySchema.parse(await req.json());

  const model = await getModelOrDefault("STORY_CHAT", body.modelId);
  if (!model) {
    return NextResponse.json(
      { error: "No Story Chat model is configured. Add one in Settings → AI Models." },
      { status: 400 }
    );
  }

  const projectContext = await assembleContext({ projectId, episodeId: body.episodeId });
  const systemPrompt = `${SYSTEM_PROMPT}\n\n# Project Context\n${projectContext}`;

  try {
    const reply = await callChatModel({
      modelId: model.modelId,
      systemPrompt,
      userPrompt: body.message,
      history: body.history,
    });
    return NextResponse.json({ reply, modelId: model.id });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
