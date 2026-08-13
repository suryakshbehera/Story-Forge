import { z } from "zod";
import { prisma, type Prisma, type SceneVisualMode } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";

export type ScenesParentType = "story" | "episode";

export class ScenesExistError extends Error {
  constructor(public existingCount: number) {
    super(`${existingCount} scene(s) already exist. Pass regenerateAll to replace them.`);
  }
}

export function parentWhere(parentType: ScenesParentType, parentId: string) {
  return parentType === "story" ? { storyId: parentId } : { episodeId: parentId };
}

const SCENE_INCLUDE = {
  characters: { select: { id: true, name: true } },
  locations: { select: { id: true, name: true } },
} satisfies Prisma.SceneInclude;

export type SceneWithTags = Prisma.SceneGetPayload<{ include: typeof SCENE_INCLUDE }>;

const aiScenesResponseSchema = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().nullable().optional(),
        description: z.string().min(1),
        visualMode: z.enum(["ILLUSTRATION", "IMAGE_TO_VIDEO"]),
        visualModeReason: z.string().nullable().optional(),
        characterNames: z.array(z.string()).default([]),
        locationNames: z.array(z.string()).default([]),
      })
    )
    .min(1),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word
// "JSON" appears below to satisfy the provider's json_object requirement.
const SCENE_PLANNING_SYSTEM_PROMPT = `You are the Scene Engine inside Narrata, a manual-first AI story/video production studio.
Break the written content in the Project Context below into an ordered list of discrete, producible scenes.

Respond with strict JSON only — no prose, no markdown code fences, no commentary. The JSON must match this shape exactly:
{
  "scenes": [
    {
      "title": "short scene title",
      "description": "what happens in this scene, written so it can drive image/video generation later",
      "visualMode": "ILLUSTRATION" or "IMAGE_TO_VIDEO",
      "visualModeReason": "one sentence explaining why this scene suits that visual mode (e.g. action/emotional beats suit IMAGE_TO_VIDEO, narration/exposition suits ILLUSTRATION)",
      "characterNames": ["exact names from the Available Characters list that appear in this scene"],
      "locationNames": ["exact names from the Available Locations list where this scene takes place"]
    }
  ]
}

Only reference names that literally appear in the "Available Characters" / "Available Locations" lists in the user prompt — never invent a name not listed there. If no characters or locations from those lists appear in a scene, use an empty array.`;

interface GenerateScenesParams {
  projectId: string;
  parentType: ScenesParentType;
  parentId: string;
  context: string;
  modelId: string;
  instructions?: string;
  regenerateAll: boolean;
}

interface GenerateScenesResult {
  scenes: SceneWithTags[];
  unmatchedNames: string[];
}

export async function generateScenes({
  projectId,
  parentType,
  parentId,
  context,
  modelId,
  instructions,
  regenerateAll,
}: GenerateScenesParams): Promise<GenerateScenesResult> {
  const where = parentWhere(parentType, parentId);

  if (!regenerateAll) {
    const existingCount = await prisma.scene.count({ where });
    if (existingCount > 0) {
      throw new ScenesExistError(existingCount);
    }
  }

  // Deliberately independent of assembleContext(), which only lists
  // *locked* characters by design. Scene tagging needs the full taggable
  // roster — don't "simplify" this into one shared list with the context
  // section above, or unlocked characters silently become untaggable.
  const [characters, locations] = await Promise.all([
    prisma.character.findMany({ where: { projectId }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { projectId }, select: { id: true, name: true } }),
  ]);

  const userPrompt = `# Project Context\n${context}\n\n# Available Characters\n${
    characters.map((c) => c.name).join("\n") || "(none yet)"
  }\n\n# Available Locations\n${
    locations.map((l) => l.name).join("\n") || "(none yet)"
  }\n\n# Instructions\n${instructions?.trim() || "Break this into scenes now."}`;

  const raw = await callChatModel({
    modelId,
    systemPrompt: SCENE_PLANNING_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }

  const parsed = aiScenesResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const charByName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const unmatchedNames = new Set<string>();

  const scenesToCreate = parsed.data.scenes.map((s, index) => {
    const characterIds = s.characterNames
      .map((name) => {
        const id = charByName.get(name.toLowerCase());
        if (!id) unmatchedNames.add(name);
        return id;
      })
      .filter((id): id is string => Boolean(id));

    const locationIds = s.locationNames
      .map((name) => {
        const id = locByName.get(name.toLowerCase());
        if (!id) unmatchedNames.add(name);
        return id;
      })
      .filter((id): id is string => Boolean(id));

    return {
      order: index + 1,
      title: s.title ?? null,
      description: s.description,
      visualMode: s.visualMode as SceneVisualMode,
      visualModeReason: s.visualModeReason ?? null,
      characterIds,
      locationIds,
    };
  });

  await prisma.$transaction(async (tx) => {
    if (regenerateAll) {
      await tx.scene.deleteMany({ where });
    }
    for (const s of scenesToCreate) {
      await tx.scene.create({
        data: {
          ...where,
          order: s.order,
          title: s.title,
          description: s.description,
          visualMode: s.visualMode,
          visualModeReason: s.visualModeReason,
          characters: { connect: s.characterIds.map((id) => ({ id })) },
          locations: { connect: s.locationIds.map((id) => ({ id })) },
        },
      });
    }
  });

  const scenes = await prisma.scene.findMany({
    where,
    orderBy: { order: "asc" },
    include: SCENE_INCLUDE,
  });

  return { scenes, unmatchedNames: Array.from(unmatchedNames) };
}

export async function resequenceScenes(tx: Prisma.TransactionClient, where: { storyId: string } | { episodeId: string }) {
  const remaining = await tx.scene.findMany({ where, orderBy: { order: "asc" } });
  for (let i = 0; i < remaining.length; i++) {
    const expectedOrder = i + 1;
    if (remaining[i].order !== expectedOrder) {
      await tx.scene.update({ where: { id: remaining[i].id }, data: { order: expectedOrder } });
    }
  }
}

export { SCENE_INCLUDE };
