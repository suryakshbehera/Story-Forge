import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma, type Asset, type Prisma, type SceneCameraMovement } from "@/lib/db";
import { parentWhere, type ScenesParentType } from "@/lib/scenes";
import { runFfmpeg, probeDuration } from "@/lib/ffmpeg";
import { storage, buildStorageKey } from "@/lib/storage";

// Canonical output format every intermediate segment is normalized to, so
// ffmpeg's concat demuxer can stream-copy them together at the end without
// re-encoding the whole final video a second time.
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const AUDIO_RATE = 44100;
const DEFAULT_ILLUSTRATION_SECONDS = 5;
const DURATION_TOLERANCE_SECONDS = 0.15;

const SCALE_PAD_FILTER = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}`;

// Ken Burns pan/zoom for ILLUSTRATION scenes — a deterministic ffmpeg
// zoompan, not an AI call. zoompan crops into the source rather than
// letterboxing it, so it prescales/crops to 2x target size first (zoompan
// is jittery fed a source close to its own output size) and deliberately
// doesn't reuse SCALE_PAD_FILTER's pad-to-fit behavior.
const CAMERA_PRESCALE_FILTER = `scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${WIDTH * 2}:${HEIGHT * 2}`;
const ZOOM_STEP_PER_FRAME = 0.0015;
const ZOOM_MAX = 1.5;
const PAN_ZOOM = 1.15; // constant zoom while panning, so panning never exposes the source's edge

function buildCameraFilter(movement: SceneCameraMovement, frames: number): string {
  if (movement === "STATIC") return SCALE_PAD_FILTER;

  const lastFrame = Math.max(frames - 1, 1);
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";
  const zoompanTail = `d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;

  switch (movement) {
    case "ZOOM_IN":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "ZOOM_OUT":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z='if(eq(on,0),${ZOOM_MAX},max(zoom-${ZOOM_STEP_PER_FRAME},1))':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "PAN_LEFT":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(1-on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "PAN_RIGHT":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "PAN_UP":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;
    case "PAN_DOWN":
      return `${CAMERA_PRESCALE_FILTER},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(on/${lastFrame})':${zoompanTail}`;
    default:
      return SCALE_PAD_FILTER;
  }
}

export interface SerializedFinalVideo {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeFinalVideo(asset: Asset): SerializedFinalVideo {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

function parentVideoWhere(parentType: ScenesParentType, parentId: string): Prisma.AssetWhereInput {
  return parentType === "story" ? { storyVideoId: parentId } : { episodeVideoId: parentId };
}

function belongsToParent(asset: Asset, parentType: ScenesParentType, parentId: string): boolean {
  return parentType === "story" ? asset.storyVideoId === parentId : asset.episodeVideoId === parentId;
}

const ASSEMBLY_SCENE_INCLUDE = {
  images: { where: { isSelected: true }, take: 1 },
  videoClips: { where: { isSelected: true }, take: 1 },
  narrationAudio: { where: { isSelected: true }, take: 1 },
  dialogueLines: {
    orderBy: { order: "asc" as const },
    include: { audio: { where: { isSelected: true }, take: 1 } },
  },
} satisfies Prisma.SceneInclude;

type AssemblyScene = Prisma.SceneGetPayload<{ include: typeof ASSEMBLY_SCENE_INCLUDE }>;

function extFromMime(mimeType: string | null): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "video/webm":
      return ".webm";
    case "video/mp4":
      return ".mp4";
    case "audio/wav":
      return ".wav";
    default:
      return "";
  }
}

async function writeAssetToTemp(asset: Asset, workDir: string, name: string): Promise<string> {
  const bytes = await storage.get(asset.storageKey);
  if (!bytes) {
    throw new Error(`Asset ${asset.id} is missing from storage (expected at ${asset.storageKey}).`);
  }
  const filePath = path.join(workDir, name + extFromMime(asset.mimeType));
  await fs.writeFile(filePath, bytes);
  return filePath;
}

function concatListFile(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}

// Narration then each dialogue line, in order — one continuous audio track
// for the scene. No audio at all (silent scene) returns null.
async function buildSceneAudioTrack(scene: AssemblyScene, workDir: string, index: number): Promise<string | null> {
  const takes: Asset[] = [];
  if (scene.narrationAudio[0]) takes.push(scene.narrationAudio[0]);
  for (const line of scene.dialogueLines) {
    if (line.audio[0]) takes.push(line.audio[0]);
  }
  if (takes.length === 0) return null;

  const clipPaths = await Promise.all(
    takes.map((take, i) => writeAssetToTemp(take, workDir, `scene${index}-audiosrc${i}`))
  );

  const audioPath = path.join(workDir, `scene${index}-audio.wav`);
  if (clipPaths.length === 1) {
    await runFfmpeg(["-i", clipPaths[0], "-ar", String(AUDIO_RATE), "-ac", "2", audioPath]);
    return audioPath;
  }

  const listPath = path.join(workDir, `scene${index}-audio-list.txt`);
  await fs.writeFile(listPath, concatListFile(clipPaths));
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-ar", String(AUDIO_RATE), "-ac", "2", audioPath]);
  return audioPath;
}

// Silent, normalized visual segment. targetDuration comes from the scene's
// audio track (null when the scene has no audio at all).
async function buildVisualSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  targetDuration: number | null
): Promise<string> {
  const outPath = path.join(workDir, `scene${index}-visual.mp4`);
  const needsClip = scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO";

  if (!needsClip) {
    const imagePath = await writeAssetToTemp(scene.images[0], workDir, `scene${index}-image`);
    const duration = targetDuration ?? DEFAULT_ILLUSTRATION_SECONDS;
    const frames = Math.max(Math.round(duration * FPS), 1);
    await runFfmpeg([
      "-loop", "1",
      "-i", imagePath,
      "-t", duration.toFixed(3),
      "-vf", buildCameraFilter(scene.cameraMovement, frames),
      "-pix_fmt", "yuv420p",
      "-an",
      outPath,
    ]);
    return outPath;
  }

  const clipPath = await writeAssetToTemp(scene.videoClips[0], workDir, `scene${index}-clip`);

  if (targetDuration === null) {
    await runFfmpeg(["-i", clipPath, "-vf", SCALE_PAD_FILTER, "-pix_fmt", "yuv420p", "-an", outPath]);
    return outPath;
  }

  const clipDuration = await probeDuration(clipPath);
  if (clipDuration < targetDuration - DURATION_TOLERANCE_SECONDS) {
    // Freeze-pad: hold the last frame for the remaining gap rather than
    // cutting the narration/dialogue off early.
    const pad = (targetDuration - clipDuration).toFixed(3);
    await runFfmpeg([
      "-i", clipPath,
      "-vf", `${SCALE_PAD_FILTER},tpad=stop_mode=clone:stop_duration=${pad}`,
      "-pix_fmt", "yuv420p",
      "-t", targetDuration.toFixed(3),
      "-an",
      outPath,
    ]);
  } else {
    // Either already matches (within tolerance) or runs long — trim to the
    // audio's exact length either way.
    await runFfmpeg(["-i", clipPath, "-t", targetDuration.toFixed(3), "-vf", SCALE_PAD_FILTER, "-pix_fmt", "yuv420p", "-an", outPath]);
  }

  return outPath;
}

async function muxSceneSegment(
  visualPath: string,
  audioPath: string | null,
  workDir: string,
  index: number,
  targetDuration: number | null
): Promise<string> {
  const outPath = path.join(workDir, `scene${index}.mp4`);
  if (audioPath) {
    await runFfmpeg(["-i", visualPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-ar", String(AUDIO_RATE), "-shortest", outPath]);
  } else {
    const silenceDuration = targetDuration ?? (await probeDuration(visualPath));
    await runFfmpeg([
      "-i", visualPath,
      "-f", "lavfi",
      "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
      "-c:v", "copy",
      "-c:a", "aac",
      "-t", silenceDuration.toFixed(3),
      outPath,
    ]);
  }
  return outPath;
}

async function buildSceneSegment(scene: AssemblyScene, workDir: string, index: number): Promise<string> {
  const audioPath = await buildSceneAudioTrack(scene, workDir, index);
  const targetDuration = audioPath ? await probeDuration(audioPath) : null;
  const visualPath = await buildVisualSegment(scene, workDir, index, targetDuration);
  return muxSceneSegment(visualPath, audioPath, workDir, index, targetDuration);
}

async function concatSegments(segmentPaths: string[], workDir: string, outPath: string): Promise<void> {
  const listPath = path.join(workDir, "concat-list.txt");
  await fs.writeFile(listPath, concatListFile(segmentPaths));
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

interface AssembleVideoParams {
  parentType: ScenesParentType;
  parentId: string;
  modelId: string;
}

export async function assembleVideo({ parentType, parentId, modelId }: AssembleVideoParams): Promise<SerializedFinalVideo> {
  const scenes = await prisma.scene.findMany({
    where: parentWhere(parentType, parentId),
    orderBy: { order: "asc" },
    include: ASSEMBLY_SCENE_INCLUDE,
  });

  if (scenes.length === 0) {
    throw new Error("There are no scenes to assemble yet.");
  }

  const unready = scenes.filter((scene) => {
    const needsClip = scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO";
    return needsClip ? scene.videoClips.length === 0 : scene.images.length === 0;
  });
  if (unready.length > 0) {
    const names = unready.map((s) => `#${s.order}${s.title ? ` "${s.title}"` : ""}`).join(", ");
    throw new Error(`These scenes don't have a selected image or video clip yet: ${names}.`);
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-assembly-"));
  try {
    const segmentPaths: string[] = [];
    for (const [index, scene] of scenes.entries()) {
      segmentPaths.push(await buildSceneSegment(scene, workDir, index));
    }

    const finalPath = path.join(workDir, "final.mp4");
    await concatSegments(segmentPaths, workDir, finalPath);

    const buffer = await fs.readFile(finalPath);
    const key = buildStorageKey(parentType === "story" ? "stories" : "episodes", parentId, "final.mp4");
    await storage.put(key, buffer);

    const parentField = parentType === "story" ? { storyVideoId: parentId } : { episodeVideoId: parentId };
    const asset = await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { ...parentVideoWhere(parentType, parentId), isSelected: true },
        data: { isSelected: false },
      });
      return tx.asset.create({
        data: {
          type: "FINAL_VIDEO",
          storageKey: key,
          fileName: "final.mp4",
          mimeType: "video/mp4",
          sizeBytes: buffer.byteLength,
          ...parentField,
          isSelected: true,
          modelId,
          createdBy: "AI",
        },
      });
    });

    return serializeFinalVideo(asset);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function getFinalVideos(parentType: ScenesParentType, parentId: string): Promise<SerializedFinalVideo[]> {
  const assets = await prisma.asset.findMany({
    where: parentVideoWhere(parentType, parentId),
    orderBy: { createdAt: "desc" },
  });
  return assets.map(serializeFinalVideo);
}

export async function selectFinalVideo(
  parentType: ScenesParentType,
  parentId: string,
  assetId: string
): Promise<SerializedFinalVideo> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (!belongsToParent(asset, parentType, parentId)) {
      throw new Error(`Final video does not belong to this ${parentType}.`);
    }
    await tx.asset.updateMany({
      where: { ...parentVideoWhere(parentType, parentId), isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeFinalVideo(updated);
  });
}

export async function deleteFinalVideo(parentType: ScenesParentType, parentId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (!belongsToParent(asset, parentType, parentId)) {
    throw new Error(`Final video does not belong to this ${parentType}.`);
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// Mirrors mapSceneVideoData in lib/scene-video.ts — for the story/episode
// pages' initial SSR load.
export function mapFinalVideos<T extends { finalVideos: Asset[] }>(parent: T) {
  return { ...parent, finalVideos: parent.finalVideos.map(serializeFinalVideo) };
}
