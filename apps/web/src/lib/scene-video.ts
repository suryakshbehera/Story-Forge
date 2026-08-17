import { prisma, type Asset } from "@/lib/db";
import { callChatModel, generateVideo, OpenRouterError } from "@/lib/ai/openrouter";
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
    include: {
      shots: { orderBy: { order: "asc" }, include: { images: { where: { isSelected: true }, take: 1 } } },
    },
  });

  if (scene.visualMode !== "IMAGE_TO_VIDEO" && scene.visualMode !== "TEXT_TO_VIDEO") {
    throw new OpenRouterError("This scene's Visual Mode isn't Image → Video or Text → Video.");
  }

  let imageDataUri: string | undefined;
  let lastFrameDataUri: string | undefined;
  let sourceImage: Asset | undefined;
  let prompt: string;

  if (scene.visualMode === "IMAGE_TO_VIDEO") {
    // Phase 8 — shots are continuity input for ONE scene-level video, not
    // individual clips: the first shot's image anchors the start, and (when
    // the scene has more than one shot) the last shot's image anchors the
    // end, so the generated clip transitions through the shots in between
    // rather than each shot generating its own separate clip.
    const firstShot = scene.shots[0];
    sourceImage = firstShot?.images[0];
    if (!sourceImage) {
      throw new OpenRouterError("Generate and select a first-shot image before generating a video clip.");
    }
    const imageBytes = await storage.get(sourceImage.storageKey);
    if (!imageBytes) {
      throw new OpenRouterError("The first shot's selected image is missing from storage.");
    }
    imageDataUri = `data:${sourceImage.mimeType ?? "image/png"};base64,${imageBytes.toString("base64")}`;

    if (scene.shots.length > 1) {
      const lastShot = scene.shots[scene.shots.length - 1];
      const lastImage = lastShot.images[0];
      if (lastImage) {
        const lastBytes = await storage.get(lastImage.storageKey);
        if (lastBytes) {
          lastFrameDataUri = `data:${lastImage.mimeType ?? "image/png"};base64,${lastBytes.toString("base64")}`;
        }
      }
    }

    const shotDescriptions = scene.shots.map((s, i) => `${i + 1}. ${s.description}`).join("\n");
    prompt =
      scene.motionPrompt?.trim() ||
      (shotDescriptions ? `${scene.description}\n\nShot progression:\n${shotDescriptions}` : scene.description);
  } else {
    prompt = scene.videoPrompt?.trim() || scene.description;
  }

  const generated = await generateVideo({
    modelId,
    prompt,
    imageDataUri,
    lastFrameDataUri,
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

const MOTION_PROMPT_SYSTEM_PROMPT = `You are the Motion Prompt drafting step inside Narrata, a manual-first AI story/video production studio.
Write a short camera/motion direction prompt for an image-to-video model, continuing smoothly from the previous scene and animating the attached current-scene image.
Describe only camera movement, subject motion, and action beats — not dialogue or narration, those are separate tracks handled elsewhere.
Respond with the motion prompt text only — no labels, quotation marks, or commentary.`;

interface DraftMotionPromptParams {
  sceneId: string;
  modelId: string;
}

// Reads the previous scene's generated clip (visually and, via OpenRouter's
// video-input content part, its audio too) plus the current scene's selected
// starting frame, in one multimodal call — grounding the drafted motion
// prompt in what actually happened last, not just what was planned. Falls
// back to the previous scene's description text when it has no selected clip
// yet (first scene, or video not generated yet). Returns a draft only — the
// caller/UI decides whether to accept it into the editable motionPrompt
// field, same "AI drafts, user approves" pattern as every other drafting job.
export async function draftMotionPrompt({ sceneId, modelId }: DraftMotionPromptParams): Promise<string> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      shots: { orderBy: { order: "asc" }, take: 1, include: { images: { where: { isSelected: true }, take: 1 } } },
    },
  });

  if (scene.visualMode !== "IMAGE_TO_VIDEO") {
    throw new OpenRouterError("Motion prompt drafting only applies to Image → Video scenes.");
  }

  const currentImage = scene.shots[0]?.images[0];
  if (!currentImage) {
    throw new OpenRouterError("Generate and select a first-shot image before drafting a motion prompt.");
  }
  const currentImageBytes = await storage.get(currentImage.storageKey);
  if (!currentImageBytes) {
    throw new OpenRouterError("The first shot's selected image is missing from storage.");
  }
  const currentImageDataUri = `data:${currentImage.mimeType ?? "image/png"};base64,${currentImageBytes.toString("base64")}`;

  const parentWhere = scene.storyId ? { storyId: scene.storyId } : { episodeId: scene.episodeId! };
  const previousScene = await prisma.scene.findFirst({
    where: { ...parentWhere, order: scene.order - 1 },
    include: { videoClips: { where: { isSelected: true }, take: 1 } },
  });

  let previousVideoDataUri: string | undefined;
  const previousClip = previousScene?.videoClips[0];
  if (previousClip) {
    const clipBytes = await storage.get(previousClip.storageKey);
    if (clipBytes) {
      previousVideoDataUri = `data:${previousClip.mimeType ?? "video/mp4"};base64,${clipBytes.toString("base64")}`;
    }
  }

  const previousContext = !previousScene
    ? "This is the first scene — there is no preceding scene."
    : previousVideoDataUri
      ? "The attached video is the immediately preceding scene's generated clip — watch and listen to it (dialogue, sound, motion, camera, ending framing) before writing the motion prompt below, so this scene continues naturally from it."
      : `The immediately preceding scene has no generated clip yet. Its description: "${previousScene.description}"`;

  const userPrompt = `# Previous scene\n${previousContext}\n\n# Current scene\nDescription: ${scene.description}\nThe attached image is this scene's starting frame — motion should build on what's actually in it, not a generic description.\n\nWrite the motion prompt now.`;

  const draft = await callChatModel({
    modelId,
    systemPrompt: MOTION_PROMPT_SYSTEM_PROMPT,
    userPrompt,
    images: [currentImageDataUri],
    videos: previousVideoDataUri ? [previousVideoDataUri] : undefined,
    temperature: 0.7,
  });

  return draft.trim();
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
