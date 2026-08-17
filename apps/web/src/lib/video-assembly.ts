import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma, type Asset, type Prisma, type CameraMovement } from "@/lib/db";
import { parentWhere, type ScenesParentType } from "@/lib/scenes";
import { runFfmpeg, probeDuration, hasAudioStream } from "@/lib/ffmpeg";
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

function buildCameraFilter(movement: CameraMovement, frames: number): string {
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
  shots: {
    orderBy: { order: "asc" as const },
    include: { images: { where: { isSelected: true }, take: 1 } },
  },
  videoClips: { where: { isSelected: true }, take: 1 },
  narrationAudio: { where: { isSelected: true }, take: 1 },
  dialogueLines: {
    orderBy: { order: "asc" as const },
    include: { audio: { where: { isSelected: true }, take: 1 } },
  },
  music: { where: { isSelected: true }, take: 1 },
  sfx: { where: { isSelected: true }, take: 1 },
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
    case "audio/mpeg":
      return ".mp3";
    case "audio/ogg":
      return ".ogg";
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

// Narration then each dialogue line, in order — one continuous voice track
// for the scene. No narration/dialogue at all returns null. Named "voice"
// (not "audio") now that music/sfx are separate layers mixed in later — see
// buildAmbienceLayer/mixAudioLayers below.
async function buildSceneVoiceTrack(scene: AssemblyScene, workDir: string, index: number): Promise<string | null> {
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

// Phase 8 — one Ken Burns clip per shot, concatenated in order. Shots with
// an explicit durationSeconds keep it; whatever's left of the scene's total
// duration splits evenly among the shots without one (floored at a minimum
// so a pathological "explicit durations already exceed the total" config
// can't produce a zero/negative-length ffmpeg segment — muxSceneSegment's
// `-shortest` mux trims any resulting overshoot against the audio anyway).
const MIN_SHOT_SECONDS = 0.5;

async function buildIllustrationSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  totalDuration: number,
  outPath: string
): Promise<string> {
  const shots = scene.shots;
  const explicitTotal = shots.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const unsetCount = shots.filter((s) => s.durationSeconds == null).length;
  const remainingDuration = Math.max(totalDuration - explicitTotal, 0);
  const evenShare = unsetCount > 0 ? remainingDuration / unsetCount : 0;

  const shotPaths: string[] = [];
  for (const [i, shot] of shots.entries()) {
    const shotDuration = Math.max(shot.durationSeconds ?? evenShare, MIN_SHOT_SECONDS);
    const shotPath = path.join(workDir, `scene${index}-shot${i}.mp4`);
    const imagePath = await writeAssetToTemp(shot.images[0], workDir, `scene${index}-shot${i}-image`);
    const frames = Math.max(Math.round(shotDuration * FPS), 1);
    await runFfmpeg([
      "-loop", "1",
      "-i", imagePath,
      "-t", shotDuration.toFixed(3),
      "-vf", buildCameraFilter(shot.cameraMovement, frames),
      "-pix_fmt", "yuv420p",
      "-an",
      shotPath,
    ]);
    shotPaths.push(shotPath);
  }

  const listPath = path.join(workDir, `scene${index}-shots-list.txt`);
  await fs.writeFile(listPath, concatListFile(shotPaths));
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  return outPath;
}

interface VisualSegmentResult {
  path: string;
  // The clip's own baked-in audio (e.g. Veo3 Lite's generated sound), pulled
  // out as a separate layer rather than left attached to the visual segment
  // — so it mixes with voice/music/sfx via mixAudioLayers below instead of
  // fighting muxSceneSegment's single-audio-input mux. null when the scene
  // has no clip, includeClipAudio is off, or the clip has no audio track.
  clipAudioPath: string | null;
}

// Extracts and pads/trims a clip's own audio track to exactly `duration`
// seconds. Silent clips (no audio stream at all — common for older/other
// video models) return null rather than erroring, since not every clip is
// expected to carry audio.
async function extractClipAudioLayer(clipPath: string, workDir: string, name: string, duration: number): Promise<string | null> {
  if (!(await hasAudioStream(clipPath))) return null;
  const outPath = path.join(workDir, `${name}.wav`);
  await runFfmpeg(["-i", clipPath, "-vn", "-af", "apad", "-t", duration.toFixed(3), "-ar", String(AUDIO_RATE), "-ac", "2", outPath]);
  return outPath;
}

// Normalized visual segment. targetDuration comes from the scene's audio
// track (null when the scene has no audio at all). The visual track itself
// is still always rendered silent (-an) and re-muxed later in
// muxSceneSegment — includeClipAudio only controls whether the clip's audio
// is *also* extracted as a layer to mix in, not whether the clip keeps its
// audio attached here.
async function buildVisualSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  targetDuration: number | null,
  includeClipAudio: boolean
): Promise<VisualSegmentResult> {
  const outPath = path.join(workDir, `scene${index}-visual.mp4`);
  const needsClip = scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO";

  if (!needsClip) {
    const duration = targetDuration ?? DEFAULT_ILLUSTRATION_SECONDS;
    return { path: await buildIllustrationSegment(scene, workDir, index, duration, outPath), clipAudioPath: null };
  }

  const clipPath = await writeAssetToTemp(scene.videoClips[0], workDir, `scene${index}-clip`);

  let duration: number;
  if (targetDuration === null) {
    await runFfmpeg(["-i", clipPath, "-vf", SCALE_PAD_FILTER, "-pix_fmt", "yuv420p", "-an", outPath]);
    duration = await probeDuration(outPath);
  } else {
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
    duration = targetDuration;
  }

  const clipAudioPath = includeClipAudio
    ? await extractClipAudioLayer(clipPath, workDir, `scene${index}-clipaudio`, duration)
    : null;

  return { path: outPath, clipAudioPath };
}

// Loops (music) or pads-with-silence (sfx) a single asset to exactly
// `duration` seconds with `volume` applied, so it can be layered under the
// scene's voice track. Looping suits a music bed shorter than the scene;
// padding suits a one-shot sound effect — looping a sound effect would sound
// like a glitch, not ambience.
async function buildAmbienceLayer(
  asset: Asset,
  workDir: string,
  name: string,
  duration: number,
  volume: number,
  loop: boolean
): Promise<string> {
  const srcPath = await writeAssetToTemp(asset, workDir, `${name}-src`);
  const outPath = path.join(workDir, `${name}.wav`);
  const durationStr = duration.toFixed(3);
  await runFfmpeg([
    ...(loop ? ["-stream_loop", "-1"] : []),
    "-i", srcPath,
    "-af", loop ? `volume=${volume}` : `volume=${volume},apad`,
    "-t", durationStr,
    "-ar", String(AUDIO_RATE),
    "-ac", "2",
    outPath,
  ]);
  return outPath;
}

// Combines whichever of voice/music/sfx layers exist into one track exactly
// `duration` seconds long. A single layer is returned as-is (no re-encode).
// normalize=0 keeps the voice track at its natural level instead of amix's
// default of dividing every input by the input count (which would make
// dialogue quieter just because music/sfx are also present) — music/sfx are
// already scaled down via their own volume filter in buildAmbienceLayer.
// alimiter is a cheap safety net against the rare case where peaks from all
// layers stack past full scale.
async function mixAudioLayers(layers: string[], workDir: string, index: number, duration: number): Promise<string | null> {
  if (layers.length === 0) return null;
  if (layers.length === 1) return layers[0];

  const outPath = path.join(workDir, `scene${index}-mixed.wav`);
  const inputArgs = layers.flatMap((p) => ["-i", p]);
  await runFfmpeg([
    ...inputArgs,
    "-filter_complex", `amix=inputs=${layers.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95`,
    "-t", duration.toFixed(3),
    "-ar", String(AUDIO_RATE),
    "-ac", "2",
    outPath,
  ]);
  return outPath;
}

async function muxSceneSegment(visualPath: string, audioPath: string | null, workDir: string, index: number, duration: number): Promise<string> {
  const outPath = path.join(workDir, `scene${index}.mp4`);
  if (audioPath) {
    await runFfmpeg(["-i", visualPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-ar", String(AUDIO_RATE), "-shortest", outPath]);
  } else {
    await runFfmpeg([
      "-i", visualPath,
      "-f", "lavfi",
      "-i", `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
      "-c:v", "copy",
      "-c:a", "aac",
      "-t", duration.toFixed(3),
      outPath,
    ]);
  }
  return outPath;
}

async function buildSceneSegment(scene: AssemblyScene, workDir: string, index: number, includeClipAudio: boolean): Promise<string> {
  const voicePath = await buildSceneVoiceTrack(scene, workDir, index);
  const baseDuration = voicePath ? await probeDuration(voicePath) : null;
  const { path: visualPath, clipAudioPath } = await buildVisualSegment(scene, workDir, index, baseDuration, includeClipAudio);
  // The visual segment is always built to an exact, known duration (either
  // baseDuration, or its own fallback/native length when baseDuration is
  // null — see buildVisualSegment) — probing it here is what lets music/sfx
  // size themselves correctly even when there's no voice track to measure.
  const finalDuration = await probeDuration(visualPath);

  const layers: string[] = [];
  if (voicePath) layers.push(voicePath);
  if (clipAudioPath) layers.push(clipAudioPath);
  if (scene.music[0]) {
    layers.push(await buildAmbienceLayer(scene.music[0], workDir, `scene${index}-music`, finalDuration, scene.musicVolume, true));
  }
  if (scene.sfx[0]) {
    layers.push(await buildAmbienceLayer(scene.sfx[0], workDir, `scene${index}-sfx`, finalDuration, scene.sfxVolume, false));
  }

  const audioPath = await mixAudioLayers(layers, workDir, index, finalDuration);
  return muxSceneSegment(visualPath, audioPath, workDir, index, finalDuration);
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
  // Off by default — matches the pre-existing behavior of always discarding
  // a video clip's own audio track (e.g. Veo3 Lite's generated sound) in
  // favor of just narration/dialogue/music/sfx.
  includeClipAudio?: boolean;
}

export async function assembleVideo({
  parentType,
  parentId,
  modelId,
  includeClipAudio = false,
}: AssembleVideoParams): Promise<SerializedFinalVideo> {
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
    if (needsClip) return scene.videoClips.length === 0;
    return scene.shots.length === 0 || scene.shots.some((s) => s.images.length === 0);
  });
  if (unready.length > 0) {
    const names = unready.map((s) => `#${s.order}${s.title ? ` "${s.title}"` : ""}`).join(", ");
    throw new Error(`These scenes don't have a selected image (every shot needs one) or video clip yet: ${names}.`);
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-assembly-"));
  try {
    const segmentPaths: string[] = [];
    for (const [index, scene] of scenes.entries()) {
      segmentPaths.push(await buildSceneSegment(scene, workDir, index, includeClipAudio));
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
