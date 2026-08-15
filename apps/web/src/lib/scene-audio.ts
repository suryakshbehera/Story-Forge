import { z } from "zod";
import { prisma, type Asset } from "@/lib/db";
import { callChatModel, generateAudio, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedAudioAsset {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeAudioAsset(asset: Asset): SerializedAudioAsset {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

function extFromMime(mimeType: string): string {
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  if (mimeType === "audio/ogg") return "ogg";
  return "mp3";
}

// ── Audio Plan — the AUDIO_PLANNING step. Drafts Scene.musicPrompt/sfxPrompt
// from the scene's own description plus a light genre/tone/visualStyle hint
// (same style-context idea as shot-images.ts's buildStyleContext, kept as
// its own small copy here rather than importing — audio planning doesn't
// need the character/location reference-image joins that file's context
// query pulls in). One deliberately-scoped-to-this-scene call, never a
// whole-episode pass — see PHASES.md Phase 7. ──────────────────────────────

async function loadAudioStyleContext(sceneId: string): Promise<{ description: string; style: string | null }> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      story: true,
      episode: { include: { season: { include: { project: { include: { storyBible: true } } } } } },
    },
  });

  if (scene.story) {
    const parts = [scene.story.genre && `Genre: ${scene.story.genre}`, scene.story.tone && `Tone: ${scene.story.tone}`].filter(
      Boolean
    );
    return { description: scene.description, style: parts.length > 0 ? parts.join("\n") : null };
  }

  const bible = scene.episode?.season.project.storyBible;
  const parts = [
    bible?.genre && `Genre: ${bible.genre}`,
    bible?.tone && `Tone: ${bible.tone}`,
    bible?.visualStyle && `Visual style: ${bible.visualStyle}`,
  ].filter(Boolean);
  return { description: scene.description, style: parts.length > 0 ? parts.join("\n") : null };
}

const audioPlanResponseSchema = z.object({
  musicPrompt: z.string(),
  sfxPrompt: z.string(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const AUDIO_PLAN_SYSTEM_PROMPT = `You are the Audio Plan step of Narrata's Music/SFX pipeline. Given one scene's description and style context, decide what background music and sound effects (if any) would suit it.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "musicPrompt": "a concrete prompt describing the background music (mood, instrumentation, tempo, genre) for a text-to-music model, or an empty string if this scene genuinely doesn't need music",
  "sfxPrompt": "a concrete prompt describing the sound effect(s) for a text-to-audio model, or an empty string if this scene genuinely doesn't need sfx"
}

Leave a field empty rather than inventing music/sfx a scene doesn't call for — not every scene needs both.`;

export interface SerializedAudioPlan {
  musicPrompt: string | null;
  sfxPrompt: string | null;
}

export async function generateAudioPlan({ sceneId, modelId }: { sceneId: string; modelId: string }): Promise<SerializedAudioPlan> {
  const { description, style } = await loadAudioStyleContext(sceneId);

  const userPrompt = [`# Scene\n${description}`, style && `# Style\n${style}`].filter(Boolean).join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: AUDIO_PLAN_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = audioPlanResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const musicPrompt = parsed.data.musicPrompt.trim() || null;
  const sfxPrompt = parsed.data.sfxPrompt.trim() || null;

  await prisma.scene.update({ where: { id: sceneId }, data: { musicPrompt, sfxPrompt } });

  return { musicPrompt, sfxPrompt };
}

// ── Music — one selected take at a time (same take-history/isSelected
// pattern as narrationAudio), generated from Scene.musicPrompt (the Audio
// Plan, possibly hand-edited since) or uploaded directly. ──────────────────

export async function generateSceneMusic({ sceneId, modelId }: { sceneId: string; modelId: string }): Promise<SerializedAudioAsset> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  if (!scene.musicPrompt?.trim()) {
    throw new OpenRouterError("Generate an Audio Plan first, or write a music prompt manually.");
  }

  const generated = await generateAudio({ modelId, prompt: scene.musicPrompt });
  const buffer = Buffer.from(generated.base64, "base64");
  const fileName = `music.${extFromMime(generated.mimeType)}`;
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { musicSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "MUSIC",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        musicSceneId: sceneId,
        isSelected: true,
        prompt: scene.musicPrompt,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioAsset(asset);
}

export async function uploadSceneMusic(sceneId: string, buffer: Buffer, fileName: string, mimeType: string): Promise<SerializedAudioAsset> {
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { musicSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "MUSIC",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        musicSceneId: sceneId,
        isSelected: true,
        createdBy: "USER",
      },
    });
  });

  return serializeAudioAsset(asset);
}

export async function selectSceneMusic(sceneId: string, assetId: string): Promise<SerializedAudioAsset> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.musicSceneId !== sceneId) throw new Error("Music take does not belong to this scene.");
    await tx.asset.updateMany({ where: { musicSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioAsset(updated);
  });
}

export async function deleteSceneMusic(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.musicSceneId !== sceneId) throw new Error("Music take does not belong to this scene.");
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// ── SFX — same shape as Music above, independent slot/prompt/model. ────────

export async function generateSceneSfx({ sceneId, modelId }: { sceneId: string; modelId: string }): Promise<SerializedAudioAsset> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  if (!scene.sfxPrompt?.trim()) {
    throw new OpenRouterError("Generate an Audio Plan first, or write an sfx prompt manually.");
  }

  const generated = await generateAudio({ modelId, prompt: scene.sfxPrompt });
  const buffer = Buffer.from(generated.base64, "base64");
  const fileName = `sfx.${extFromMime(generated.mimeType)}`;
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { sfxSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "SFX",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        sfxSceneId: sceneId,
        isSelected: true,
        prompt: scene.sfxPrompt,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioAsset(asset);
}

export async function uploadSceneSfx(sceneId: string, buffer: Buffer, fileName: string, mimeType: string): Promise<SerializedAudioAsset> {
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { sfxSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "SFX",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        sfxSceneId: sceneId,
        isSelected: true,
        createdBy: "USER",
      },
    });
  });

  return serializeAudioAsset(asset);
}

export async function selectSceneSfx(sceneId: string, assetId: string): Promise<SerializedAudioAsset> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.sfxSceneId !== sceneId) throw new Error("SFX take does not belong to this scene.");
    await tx.asset.updateMany({ where: { sfxSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioAsset(updated);
  });
}

export async function deleteSceneSfx(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.sfxSceneId !== sceneId) throw new Error("SFX take does not belong to this scene.");
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// Mirrors mapSceneVideoData in lib/scene-video.ts — for the scene pages'
// initial SSR load.
export function mapSceneAudioData<T extends { music: Asset[]; sfx: Asset[] }>(scene: T) {
  return {
    ...scene,
    music: scene.music.map(serializeAudioAsset),
    sfx: scene.sfx.map(serializeAudioAsset),
  };
}
