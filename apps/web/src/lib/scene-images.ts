import { z } from "zod";
import { prisma, type Asset } from "@/lib/db";
import { callChatModel, generateImage, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedSceneImage {
  id: string;
  url: string;
  isSelected: boolean;
  validationPassed: boolean | null;
  validationNotes: string | null;
  createdAt: Date;
}

export function serializeSceneImage(asset: Asset): SerializedSceneImage {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    validationPassed: asset.validationPassed,
    validationNotes: asset.validationNotes,
    createdAt: asset.createdAt,
  };
}

const SCENE_CONTEXT_INCLUDE = {
  characters: { include: { referenceImages: true } },
  locations: { include: { referenceImages: true } },
  story: true,
  episode: { include: { season: { include: { project: { include: { storyBible: true } } } } } },
} as const;

async function loadSceneContext(sceneId: string) {
  return prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: SCENE_CONTEXT_INCLUDE,
  });
}

type SceneContext = Awaited<ReturnType<typeof loadSceneContext>>;

// Loose visual-style hint pulled from whichever parent exists — Story (Single
// Video) has no dedicated visualStyle field, only StoryBible (Series) does,
// so this falls back to genre/tone for Single Video projects.
function buildStyleContext(scene: SceneContext): string | null {
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

const IMAGE_PROMPT_SYSTEM_PROMPT = `You are the Image Prompt step of Narrata's Image pipeline. Turn the scene description and tagged character/location details below into a single polished, concrete image-generation prompt for a text-to-image model.

Describe composition, subjects, setting, lighting, and mood in one paragraph. Output only the prompt text itself — no meta-commentary, no markdown, no explanations.`;

async function buildImagePrompt(
  scene: SceneContext,
  styleContext: string | null,
  instructions: string | undefined,
  modelId: string
): Promise<string> {
  const characterBlocks = scene.characters
    .map((c) => [`${c.name}:`, c.appearance, c.clothing].filter(Boolean).join(" "))
    .join("\n");
  const locationBlocks = scene.locations
    .map((l) => [`${l.name}:`, l.description, l.architecture, l.environment, l.timeWeather].filter(Boolean).join(" "))
    .join("\n");

  const userPrompt = [
    `# Scene\n${scene.description}`,
    scene.visualMode === "IMAGE_TO_VIDEO" && "This image will be the starting frame of a video clip.",
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
const IMAGE_VALIDATION_SYSTEM_PROMPT = `You are the Image Validation step of Narrata's Image pipeline. The first image provided is a newly generated scene image. The remaining images are locked reference images for named characters/locations, given in the order listed in the user prompt.

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

  const userPrompt = `Reference images, in order: ${entities.map((e) => e.name).join(", ")}.\n\nDoes the generated scene image stay consistent with these references? Respond with the required JSON.`;

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

interface GenerateSceneImageParams {
  sceneId: string;
  promptModelId: string;
  imageModelId: string;
  // null when no IMAGE_VALIDATION model is configured — validation is
  // skipped entirely (advisory step only, never blocks generation).
  validationModelId: string | null;
  instructions?: string;
}

interface GenerateSceneImageResult {
  image: SerializedSceneImage;
  missingReferenceFor: string[];
}

export async function generateSceneImage({
  sceneId,
  promptModelId,
  imageModelId,
  validationModelId,
  instructions,
}: GenerateSceneImageParams): Promise<GenerateSceneImageResult> {
  const scene = await loadSceneContext(sceneId);
  const styleContext = buildStyleContext(scene);

  const prompt = await buildImagePrompt(scene, styleContext, instructions, promptModelId);
  const generated = await generateImage({ modelId: imageModelId, prompt });

  const buffer = Buffer.from(generated.base64, "base64");
  const ext = extFromMime(generated.mimeType);
  const fileName = `scene-image.${ext}`;
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  // Validation only applies to locked characters (mirrors assemble.ts's
  // locked-only rule) and all tagged locations (no lock concept for
  // locations — see Location model comment in schema.prisma).
  const validationTargets: ValidationEntity[] = [
    ...scene.characters.filter((c) => c.isLocked).map((c) => ({ name: c.name, referenceImages: c.referenceImages })),
    ...scene.locations.map((l) => ({ name: l.name, referenceImages: l.referenceImages })),
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
    await tx.asset.updateMany({ where: { sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        sceneId,
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

  return { image: serializeSceneImage(asset), missingReferenceFor };
}

// User-uploaded scene image — same "slot" and isSelected takeover behavior
// as an AI-generated one (see generateSceneImage above), just skipping the
// prompt/generation/validation steps. type stays GENERATED_IMAGE since that's
// what marks an Asset as belonging to the scene's image gallery (see
// Scene.images comment in schema.prisma); createdBy is what actually
// distinguishes it as user-supplied, same idiom as REFERENCE_IMAGE uploads.
export async function uploadSceneImage(
  sceneId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<SerializedSceneImage> {
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "GENERATED_IMAGE",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        sceneId,
        isSelected: true,
        createdBy: "USER",
      },
    });
  });

  return serializeSceneImage(asset);
}

export async function selectSceneImage(sceneId: string, assetId: string): Promise<SerializedSceneImage> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.sceneId !== sceneId) {
      throw new Error("Asset does not belong to this scene.");
    }
    await tx.asset.updateMany({ where: { sceneId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeSceneImage(updated);
  });
}

export async function deleteSceneImage(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.sceneId !== sceneId) {
    throw new Error("Asset does not belong to this scene.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}
