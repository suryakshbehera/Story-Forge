import fs from "fs/promises";
import os from "os";
import path from "path";
import { prisma, type Asset } from "@/lib/db";
import { generateMusic, generateSoundEffect, ElevenLabsError } from "@/lib/ai/elevenlabs";
import { storage, buildStorageKey } from "@/lib/storage";
import { probeDuration } from "@/lib/ffmpeg";

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

// Estimates how long the generated music/sfx clip should be: the scene's
// voice track (selected narration + selected dialogue line takes, same set
// buildSceneVoiceTrack in video-assembly.ts concatenates), probed via
// ffprobe. Without this, generateAudio() had no length hint at all and the
// underlying model defaulted to its own multi-minute clip length regardless
// of how short the scene actually was. Returns null (no hint passed) if the
// scene has no voice audio yet — e.g. music generated before narration.
async function getSceneVoiceDurationSeconds(sceneId: string): Promise<number | null> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      narrationAudio: { where: { isSelected: true }, take: 1 },
      dialogueLines: { include: { audio: { where: { isSelected: true }, take: 1 } } },
    },
  });

  const takes: Asset[] = [...scene.narrationAudio];
  for (const line of scene.dialogueLines) {
    if (line.audio[0]) takes.push(line.audio[0]);
  }
  if (takes.length === 0) return null;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-audio-duration-"));
  try {
    let total = 0;
    for (const [i, take] of takes.entries()) {
      const bytes = await storage.get(take.storageKey);
      if (!bytes) continue;
      const filePath = path.join(workDir, `take${i}`);
      await fs.writeFile(filePath, bytes);
      total += await probeDuration(filePath);
    }
    return total > 0 ? total : null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

// ── Music — one selected take at a time (same take-history/isSelected
// pattern as narrationAudio), generated from Scene.musicPrompt (the Audio
// Plan, possibly hand-edited since) or uploaded directly. ──────────────────

export async function generateSceneMusic({ sceneId, modelId }: { sceneId: string; modelId: string }): Promise<SerializedAudioAsset> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  if (!scene.musicPrompt?.trim()) {
    throw new ElevenLabsError("Generate an Audio Plan first, or write a music prompt manually.");
  }

  const durationSeconds = await getSceneVoiceDurationSeconds(sceneId);
  const generated = await generateMusic({ prompt: scene.musicPrompt, durationSeconds: durationSeconds ?? undefined });
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
    throw new ElevenLabsError("Generate an Audio Plan first, or write an sfx prompt manually.");
  }

  const durationSeconds = await getSceneVoiceDurationSeconds(sceneId);
  const generated = await generateSoundEffect({ modelId, prompt: scene.sfxPrompt, durationSeconds: durationSeconds ?? undefined });
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
