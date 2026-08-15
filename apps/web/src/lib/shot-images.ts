import { z } from "zod";
import { prisma, type Asset } from "@/lib/db";
import { callChatModel, generateImage, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedShotImage {
  id: string;
  url: string;
  isSelected: boolean;
  validationPassed: boolean | null;
  validationNotes: string | null;
  createdAt: Date;
}

export function serializeShotImage(asset: Asset): SerializedShotImage {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    validationPassed: asset.validationPassed,
    validationNotes: asset.validationNotes,
    createdAt: asset.createdAt,
  };
}

const SHOT_CONTEXT_INCLUDE = {
  scene: {
    include: {
      characters: { include: { referenceImages: true } },
      locations: { include: { referenceImages: true } },
      story: true,
      episode: { include: { season: { include: { project: { include: { storyBible: true } } } } } },
    },
  },
} as const;

async function loadShotContext(shotId: string) {
  return prisma.shot.findUniqueOrThrow({
    where: { id: shotId },
    include: SHOT_CONTEXT_INCLUDE,
  });
}

type ShotContext = Awaited<ReturnType<typeof loadShotContext>>;

// Loose visual-style hint pulled from whichever parent exists — Story (Single
// Video) has no dedicated visualStyle field, only StoryBible (Series) does,
// so this falls back to genre/tone for Single Video projects.
function buildStyleContext(scene: ShotContext["scene"]): string | null {
  if (scene.story) {
    const parts = [scene.story.genre && `Genre: ${scene.story.genre}`, scene.story.tone && `Tone: ${scene.story.tone}`].filter(
      Boolean
    );
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const bible = scene.episode?.season.project.storyBible;
  if (!bible) return null;
  const parts = [
    bible.genre && `Genre: ${bible.genre}`,
    bible.tone && `Tone: ${bible.tone}`,
    bible.visualStyle && `Visual style: ${bible.visualStyle}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

const IMAGE_PROMPT_SYSTEM_PROMPT = `You are the Image Prompt step of Narrata's Image pipeline. Turn the shot description below — plus the broader scene it belongs to and any tagged character/location details — into a single polished, concrete image-generation prompt for a text-to-image model.

The shot description is the primary framing (what's actually on screen); the scene description is context for continuity, not the subject to draw literally. Describe composition, subjects, setting, lighting, and mood in one paragraph. Output only the prompt text itself — no meta-commentary, no markdown, no explanations.`;

async function buildImagePrompt(
  shot: ShotContext,
  styleContext: string | null,
  instructions: string | undefined,
  modelId: string
): Promise<string> {
  const scene = shot.scene;
  const characterBlocks = scene.characters
    .map((c) => [`${c.name}:`, c.appearance, c.clothing].filter(Boolean).join(" "))
    .join("\n");
  const locationBlocks = scene.locations
    .map((l) => [`${l.name}:`, l.description, l.architecture, l.environment, l.timeWeather].filter(Boolean).join(" "))
    .join("\n");

  const userPrompt = [
    `# Shot\n${shot.description}`,
    `# Scene context\n${scene.description}`,
    scene.visualMode === "IMAGE_TO_VIDEO" && "This image will feed a video generation call as a continuity frame.",
    characterBlocks && `# Characters in this scene\n${characterBlocks}`,
    locationBlocks && `# Locations in this scene\n${locationBlocks}`,
    styleContext && `# Style\n${styleContext}`,
    instructions?.trim() && `# Additional instructions\n${instructions.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = await callChatModel({
    modelId,
    systemPrompt: IMAGE_PROMPT_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.7,
  });

  return prompt.trim();
}

const validationResponseSchema = z.object({
  passed: z.boolean(),
  notes: z.string(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const IMAGE_VALIDATION_SYSTEM_PROMPT = `You are the Image Validation step of Narrata's Image pipeline. The first image provided is a newly generated shot image. The remaining images are locked reference images for named characters/locations, given in the order listed in the user prompt.

Judge whether the newly generated image stays visually consistent with those references (character appearance/clothing, location architecture/environment) — minor stylistic differences are fine, but a different-looking character or place is not.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{ "passed": true or false, "notes": "one or two sentences explaining the judgment" }`;

interface ValidationEntity {
  name: string;
  referenceImages: Asset[];
}

async function runValidation(
  generatedImageDataUri: string,
  entities: ValidationEntity[],
  modelId: string
): Promise<{ passed: boolean; notes: string }> {
  const referenceImages = await Promise.all(
    entities.map(async (e) => {
      const ref = e.referenceImages[0];
      const bytes = await storage.get(ref.storageKey);
      if (!bytes) throw new OpenRouterError(`Reference image for ${e.name} is missing from storage.`);
      return `data:${ref.mimeType ?? "image/png"};base64,${bytes.toString("base64")}`;
    })
  );

  const userPrompt = `Reference images, in order: ${entities.map((e) => e.name).join(", ")}.\n\nDoes the generated shot image stay consistent with these references? Respond with the required JSON.`;

  const raw = await callChatModel({
    modelId,
    systemPrompt: IMAGE_VALIDATION_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
    images: [generatedImageDataUri, ...referenceImages],
  });

  const parsed = validationResponseSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new OpenRouterError("Validation model returned an unexpected shape.");
  }
  return parsed.data;
}

function extFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

interface GenerateShotImageParams {
  shotId: string;
  promptModelId: string;
  imageModelId: string;
  // null when no IMAGE_VALIDATION model is configured — validation is
  // skipped entirely (advisory step only, never blocks generation).
  validationModelId: string | null;
  instructions?: string;
}

interface GenerateShotImageResult {
  image: SerializedShotImage;
  missingReferenceFor: string[];
}

export async function generateShotImage({
  shotId,
  promptModelId,
  imageModelId,
  validationModelId,
  instructions,
}: GenerateShotImageParams): Promise<GenerateShotImageResult> {
  const shot = await loadShotContext(shotId);
  const styleContext = buildStyleContext(shot.scene);

  const prompt = await buildImagePrompt(shot, styleContext, instructions, promptModelId);
  const generated = await generateImage({ modelId: imageModelId, prompt });

  const buffer = Buffer.from(generated.base64, "base64");
  const ext = extFromMime(generated.mimeType);
  const fileName = `shot-image.${ext}`;
  const key = buildStorageKey("shots", shotId, fileName);
  await storage.put(key, buffer);

  // Validation only applies to locked characters (mirrors assemble.ts's
  // locked-only rule) and all tagged locations (no lock concept for
  // locations) — tags stay scene-level, shots share their scene's roster.
  const validationTargets: ValidationEntity[] = [
    ...shot.scene.characters.filter((c) => c.isLocked).map((c) => ({ name: c.name, referenceImages: c.referenceImages })),
    ...shot.scene.locations.map((l) => ({ name: l.name, referenceImages: l.referenceImages })),
  ];
  const missingReferenceFor = validationTargets.filter((t) => t.referenceImages.length === 0).map((t) => t.name);
  const validatable = validationTargets.filter((t) => t.referenceImages.length > 0);

  let validation: { passed: boolean; notes: string } | null = null;
  if (validatable.length > 0 && validationModelId) {
    try {
      const generatedDataUri = `data:${generated.mimeType};base64,${generated.base64}`;
      validation = await runValidation(generatedDataUri, validatable, validationModelId);
    } catch {
      // Advisory only — a broken/unconfigured validation step never blocks
      // the generated image from being saved and selected.
      validation = null;
    }
  }

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        shotId,
        isSelected: true,
        prompt,
        modelId: imageModelId,
        createdBy: "AI",
        validationPassed: validation?.passed ?? null,
        validationNotes: validation?.notes ?? null,
        validationModelId: validation ? validationModelId : null,
      },
    });
  });

  return { image: serializeShotImage(asset), missingReferenceFor };
}

// User-uploaded shot image — same "slot" and isSelected takeover behavior
// as an AI-generated one (see generateShotImage above), just skipping the
// prompt/generation/validation steps.
export async function uploadShotImage(
  shotId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<SerializedShotImage> {
  const key = buildStorageKey("shots", shotId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        shotId,
        isSelected: true,
        createdBy: "USER",
      },
    });
  });

  return serializeShotImage(asset);
}

export async function selectShotImage(shotId: string, assetId: string): Promise<SerializedShotImage> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.shotId !== shotId) {
      throw new Error("Asset does not belong to this shot.");
    }
    await tx.asset.updateMany({ where: { shotId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeShotImage(updated);
  });
}

export async function deleteShotImage(shotId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.shotId !== shotId) {
    throw new Error("Asset does not belong to this shot.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}
