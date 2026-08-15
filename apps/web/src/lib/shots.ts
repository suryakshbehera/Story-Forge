import { z } from "zod";
import { prisma, type Prisma, type CameraMovement } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { storage } from "@/lib/storage";

const SHOT_INCLUDE = {
  images: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      storageKey: true,
      isSelected: true,
      validationPassed: true,
      validationNotes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ShotInclude;

export type ShotWithImages = Prisma.ShotGetPayload<{ include: typeof SHOT_INCLUDE }>;

// storageKey is a server-side detail — replace each image with a
// client-facing url before a shot ever gets sent in a response. Mirrors
// scenes.ts's mapSceneShots, one level down.
export function mapShotImages<T extends ShotWithImages>(shot: T) {
  return {
    ...shot,
    images: shot.images.map((img) => ({
      id: img.id,
      url: storage.url(img.storageKey),
      isSelected: img.isSelected,
      validationPassed: img.validationPassed,
      validationNotes: img.validationNotes,
      createdAt: img.createdAt,
    })),
  };
}

export function mapShotsImages<T extends ShotWithImages>(shots: T[]) {
  return shots.map(mapShotImages);
}

export async function resequenceShots(tx: Prisma.TransactionClient, sceneId: string) {
  const remaining = await tx.shot.findMany({ where: { sceneId }, orderBy: { order: "asc" } });
  for (let i = 0; i < remaining.length; i++) {
    const expectedOrder = i + 1;
    if (remaining[i].order !== expectedOrder) {
      await tx.shot.update({ where: { id: remaining[i].id }, data: { order: expectedOrder } });
    }
  }
}

export { SHOT_INCLUDE };

// ── AI shot planning (SHOT_PLANNING) — mirrors SCENE_PLANNING one level
// down: Story→Scenes becomes Scene→Shots. Always scoped to one scene, same
// "never a whole-episode pass" rule the rest of the per-scene AI steps
// follow. ─────────────────────────────────────────────────────────────────

export class ShotsExistError extends Error {
  constructor(public existingCount: number) {
    super(`${existingCount} shot(s) already exist. Pass regenerateAll to replace them.`);
  }
}

const CAMERA_MOVEMENTS = ["STATIC", "ZOOM_IN", "ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "PAN_DOWN"] as const;

const aiShotsResponseSchema = z.object({
  shots: z
    .array(
      z.object({
        description: z.string().min(1),
        cameraMovement: z.enum(CAMERA_MOVEMENTS).nullable().optional(),
      })
    )
    .min(1),
  reason: z.string().nullable().optional(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word
// "JSON" appears below to satisfy the provider's json_object requirement.
const SHOT_PLANNING_SYSTEM_PROMPT = `You are the Shot Engine inside Narrata, a manual-first AI story/video production studio.
Break the scene below into an ordered sequence of distinct shots — successive camera compositions that together tell the scene, each one a different moment or framing. Shots are continuity, not alternates: shot 2 continues on from shot 1, it never re-describes the same instant.

Pick a shot count that suits the scene's actual content — a short exchange might need only 1-2 shots; a scene with several dialogue exchanges or a change in action typically wants roughly one shot per speaker change or story beat. Don't pad the count for its own sake.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "shots": [
    { "description": "what's on screen in this shot: framing, subject, action, expression", "cameraMovement": "STATIC" | "ZOOM_IN" | "ZOOM_OUT" | "PAN_LEFT" | "PAN_RIGHT" | "PAN_UP" | "PAN_DOWN" }
  ],
  "reason": "one sentence explaining the shot count and how it splits the scene"
}`;

interface GenerateShotsParams {
  sceneId: string;
  modelId: string;
  regenerateAll: boolean;
}

interface GenerateShotsResult {
  shots: ReturnType<typeof mapShotsImages>;
  reason: string | null;
}

export async function generateShots({ sceneId, modelId, regenerateAll }: GenerateShotsParams): Promise<GenerateShotsResult> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      dialogueLines: { orderBy: { order: "asc" }, include: { character: { select: { name: true } } } },
    },
  });

  if (!regenerateAll) {
    const existingCount = await prisma.shot.count({ where: { sceneId } });
    if (existingCount > 0) {
      throw new ShotsExistError(existingCount);
    }
  }

  const dialogueBlock = scene.dialogueLines.map((l) => `${l.character.name}: ${l.text}`).join("\n");
  const userPrompt = [
    `# Scene\n${scene.description}`,
    scene.narration?.trim() && `# Narration\n${scene.narration}`,
    dialogueBlock && `# Dialogue\n${dialogueBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: SHOT_PLANNING_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = aiShotsResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const shots = await prisma.$transaction(async (tx) => {
    if (regenerateAll) {
      await tx.shot.deleteMany({ where: { sceneId } });
    }
    const created: Prisma.ShotGetPayload<{ include: typeof SHOT_INCLUDE }>[] = [];
    for (const [index, s] of parsed.data.shots.entries()) {
      created.push(
        await tx.shot.create({
          data: {
            sceneId,
            order: index + 1,
            description: s.description,
            cameraMovement: (s.cameraMovement ?? "STATIC") as CameraMovement,
          },
          include: SHOT_INCLUDE,
        })
      );
    }
    return created;
  });

  return { shots: mapShotsImages(shots), reason: parsed.data.reason ?? null };
}
