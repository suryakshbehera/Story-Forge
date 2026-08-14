import { prisma, type Asset } from "@/lib/db";
import { generateVideo, OpenRouterError } from "@/lib/ai/openrouter";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedSceneVideoClip {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeSceneVideoClip(asset: Asset): SerializedSceneVideoClip {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

function extFromMime(mimeType: string): string {
  if (mimeType === "video/webm") return "webm";
  return "mp4";
}

interface GenerateSceneVideoParams {
  sceneId: string;
  modelId: string;
}

export async function generateSceneVideo({ sceneId, modelId }: GenerateSceneVideoParams): Promise<SerializedSceneVideoClip> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { images: { where: { isSelected: true }, take: 1 } },
  });

  if (scene.visualMode !== "IMAGE_TO_VIDEO" && scene.visualMode !== "TEXT_TO_VIDEO") {
    throw new OpenRouterError("This scene's Visual Mode isn't Image → Video or Text → Video.");
  }

  let imageDataUri: string | undefined;
  let sourceImage: Asset | undefined;
  let prompt: string;

  if (scene.visualMode === "IMAGE_TO_VIDEO") {
    sourceImage = scene.images[0];
    if (!sourceImage) {
      throw new OpenRouterError("Generate and select a scene image before generating a video clip.");
    }
    const imageBytes = await storage.get(sourceImage.storageKey);
    if (!imageBytes) {
      throw new OpenRouterError("The scene's selected image is missing from storage.");
    }
    imageDataUri = `data:${sourceImage.mimeType ?? "image/png"};base64,${imageBytes.toString("base64")}`;
    prompt = scene.motionPrompt?.trim() || scene.description;
  } else {
    prompt = scene.videoPrompt?.trim() || scene.description;
  }

  const generated = await generateVideo({
    modelId,
    prompt,
    imageDataUri,
    durationSeconds: scene.videoDurationSeconds ?? undefined,
  });

  const buffer = Buffer.from(generated.base64, "base64");
  const ext = extFromMime(generated.mimeType);
  const fileName = `scene-video.${ext}`;
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: { videoSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    return tx.asset.create({
      data: {
        type: "VIDEO_CLIP",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        videoSceneId: sceneId,
        sourceImageId: sourceImage?.id,
        isSelected: true,
        prompt,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeSceneVideoClip(asset);
}

export async function getSceneVideoClips(sceneId: string): Promise<SerializedSceneVideoClip[]> {
  const assets = await prisma.asset.findMany({
    where: { videoSceneId: sceneId },
    orderBy: { createdAt: "desc" },
  });
  return assets.map(serializeSceneVideoClip);
}

export async function selectSceneVideoClip(sceneId: string, assetId: string): Promise<SerializedSceneVideoClip> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.videoSceneId !== sceneId) {
      throw new Error("Video clip does not belong to this scene.");
    }
    await tx.asset.updateMany({ where: { videoSceneId: sceneId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeSceneVideoClip(updated);
  });
}

export async function deleteSceneVideoClip(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.videoSceneId !== sceneId) {
    throw new Error("Video clip does not belong to this scene.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// Mirrors mapSceneVoiceData in lib/voice.ts — for the scene pages' initial
// SSR load, serializing the videoClips relation the same way the API routes
// below do, so the client gets an identical shape regardless of source.
export function mapSceneVideoData<T extends { videoClips: Asset[] }>(scene: T) {
  return {
    ...scene,
    videoClips: scene.videoClips.map(serializeSceneVideoClip),
  };
}
