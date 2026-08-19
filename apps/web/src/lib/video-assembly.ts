import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma, type Asset, type Prisma, type CameraMovement } from "@/lib/db";
import { parentWhere, type ScenesParentType } from "@/lib/scenes";
import { runFfmpeg, probeDuration, hasAudioStream } from "@/lib/ffmpeg";
import { storage, buildStorageKey } from "@/lib/storage";

// Canonical output format every intermediate segment is normalized to, so
// ffmpeg's concat demuxer can stream-copy them together at the end without
// re-encoding the whole final video a second time. Used for the real,
// user-facing render (assembleVideo) — never implicitly defaulted to, always
// passed explicitly, so a future second VisualTarget can't accidentally leak
// into the actual final output.
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const AUDIO_RATE = 44100;
const DEFAULT_ILLUSTRATION_SECONDS = 5;
const DURATION_TOLERANCE_SECONDS = 0.15;
// Crossfade length between consecutive scenes in the real final render —
// clamped per-pair to each neighbor's own duration (see
// crossfadeConcatSegments) so a very short scene can't demand an overlap
// longer than the scene itself.
const SCENE_TRANSITION_SECONDS = 0.4;
const MIN_TRANSITION_SECONDS = 0.05;

interface VisualTarget {
  width: number;
  height: number;
  fps: number;
}

const FULL_RES: VisualTarget = { width: WIDTH, height: HEIGHT, fps: FPS };

// The AI-facing silent picture (assembleSilentPicture, for Audio Cue
// Planning) doesn't need — or benefit from — full-resolution/framerate: a
// video-understanding model reads scene content/pacing/mood from it, not
// fine detail, and Ken Burns' zoompan cost scales with output pixel count ×
// frame count. Cuts both the ffmpeg encode time (the dominant cost of
// drafting a cue plan on a real episode, observed live: ~9 minutes for a
// 10-scene/33-shot episode at full res) and the base64 upload size, without
// touching the real final render at all — assembleVideo always passes
// FULL_RES explicitly, never this.
const CUE_PLAN_RES: VisualTarget = { width: 640, height: 360, fps: 8 };

function scalePadFilter({ width, height, fps }: VisualTarget): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;
}

// Ken Burns pan/zoom for ILLUSTRATION scenes — a deterministic ffmpeg
// zoompan, not an AI call. zoompan crops into the source rather than
// letterboxing it, so it prescales/crops to 2x target size first (zoompan
// is jittery fed a source close to its own output size) and deliberately
// doesn't reuse scalePadFilter's pad-to-fit behavior.
function cameraPrescaleFilter({ width, height }: VisualTarget): string {
  return `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2}`;
}
const ZOOM_STEP_PER_FRAME = 0.0015;
const ZOOM_MAX = 1.5;
const PAN_ZOOM = 1.15; // constant zoom while panning, so panning never exposes the source's edge

function buildCameraFilter(movement: CameraMovement, frames: number, target: VisualTarget): string {
  if (movement === "STATIC") return scalePadFilter(target);

  const prescale = cameraPrescaleFilter(target);
  const lastFrame = Math.max(frames - 1, 1);
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";
  const zoompanTail = `d=${frames}:s=${target.width}x${target.height}:fps=${target.fps}`;

  switch (movement) {
    case "ZOOM_IN":
      return `${prescale},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "ZOOM_OUT":
      return `${prescale},zoompan=z='if(eq(on,0),${ZOOM_MAX},max(zoom-${ZOOM_STEP_PER_FRAME},1))':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "PAN_LEFT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(1-on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "PAN_RIGHT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "PAN_UP":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;
    case "PAN_DOWN":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(on/${lastFrame})':${zoompanTail}`;
    default:
      return scalePadFilter(target);
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
  // No `take: 1` — a scene's selected take can be several frame-chained
  // segments (see Asset.videoBatchId/videoSegmentOrder in scene-video.ts),
  // all sharing isSelected: true, ordered so buildVisualSegment can
  // concatenate them back into one continuous clip.
  videoClips: { where: { isSelected: true }, orderBy: { videoSegmentOrder: "asc" } },
  narrationAudio: { where: { isSelected: true }, take: 1 },
  dialogueLines: {
    orderBy: { order: "asc" as const },
    include: {
      audio: { where: { isSelected: true }, take: 1 },
      // Only needed by assembleSilentPicture's cue-plan manifest below
      // (buildSceneVoiceTrack ignores it) — included here rather than a
      // second scene include so both passes share one query shape.
      character: { select: { name: true } },
    },
  },
  // Same reasoning as dialogueLines.character above — only read by
  // assembleSilentPicture, for the cue-planning prompt's per-scene roster.
  characters: { select: { name: true } },
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

// Phase 8 — one Ken Burns clip per shot, concatenated in order. Phase 11:
// each shot's duration is now purely its own — an explicit
// Shot.durationSeconds, or DEFAULT_ILLUSTRATION_SECONDS when unset — rather
// than splitting whatever's left of a scene-level total (that total used to
// come from the scene's narration/dialogue length, which no longer drives
// visual timing; see buildSceneSegment). Floored at a minimum so a
// pathological explicit 0/negative value can't produce a zero-length ffmpeg
// segment.
const MIN_SHOT_SECONDS = 0.5;

async function buildIllustrationSegment(scene: AssemblyScene, workDir: string, index: number, outPath: string, target: VisualTarget): Promise<string> {
  const shots = scene.shots;

  const shotPaths: string[] = [];
  for (const [i, shot] of shots.entries()) {
    const shotDuration = Math.max(shot.durationSeconds ?? DEFAULT_ILLUSTRATION_SECONDS, MIN_SHOT_SECONDS);
    const shotPath = path.join(workDir, `scene${index}-shot${i}.mp4`);
    const imagePath = await writeAssetToTemp(shot.images[0], workDir, `scene${index}-shot${i}-image`);
    const frames = Math.max(Math.round(shotDuration * target.fps), 1);
    await runFfmpeg([
      "-loop", "1",
      "-i", imagePath,
      "-t", shotDuration.toFixed(3),
      "-vf", buildCameraFilter(shot.cameraMovement, frames, target),
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
  // Raw (pre scale/pad) temp clip path for IMAGE_TO_VIDEO/TEXT_TO_VIDEO
  // scenes — kept around so buildSceneSegment can extract the clip's own
  // baked-in audio (extractClipAudioLayer) once the scene's finalDuration is
  // known, which happens after this returns. null for ILLUSTRATION scenes.
  clipPath: string | null;
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

// Silent, normalized visual segment at the scene's own native/explicit
// duration — IMAGE_TO_VIDEO/TEXT_TO_VIDEO scenes use the clip's own native
// length; ILLUSTRATION shots use their own durationSeconds (see
// buildIllustrationSegment). Phase 11: no longer sized to the scene's
// narration/dialogue — the picture is assembled first and is authoritative;
// voice is fit to *it* instead (see padVoiceToMatch/padVisualToMatch in
// buildSceneSegment) so cue planning has a locked timeline to plan against.
async function buildVisualSegment(scene: AssemblyScene, workDir: string, index: number, target: VisualTarget): Promise<VisualSegmentResult> {
  const outPath = path.join(workDir, `scene${index}-visual.mp4`);
  const needsClip = scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO";

  if (!needsClip) {
    return { path: await buildIllustrationSegment(scene, workDir, index, outPath, target), clipPath: null };
  }

  const clipPath = await resolveSceneClipPath(scene.videoClips, workDir, index);
  await runFfmpeg(["-i", clipPath, "-vf", scalePadFilter(target), "-pix_fmt", "yuv420p", "-an", outPath]);
  return { path: outPath, clipPath };
}

// A scene's selected take may be one clip (legacy/single-segment) or several
// frame-chained segments generated by one call (see Asset.videoBatchId).
// Multi-segment batches are concatenated — preserving each segment's own
// audio track, not just video — into one raw clip first, so downstream code
// (the scale/pad step above, and extractClipAudioLayer below) can keep
// treating "this scene's clip" as a single file. Re-encodes rather than
// `-c copy`: independently generated segments aren't guaranteed to share
// identical codec parameters.
async function resolveSceneClipPath(clips: Asset[], workDir: string, index: number): Promise<string> {
  if (clips.length <= 1) {
    return writeAssetToTemp(clips[0], workDir, `scene${index}-clip`);
  }
  const rawPaths = await Promise.all(clips.map((clip, i) => writeAssetToTemp(clip, workDir, `scene${index}-clip${i}-raw`)));
  const listPath = path.join(workDir, `scene${index}-clips-list.txt`);
  await fs.writeFile(listPath, concatListFile(rawPaths));
  const outPath = path.join(workDir, `scene${index}-clip-concat.mp4`);
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-pix_fmt", "yuv420p", outPath]);
  return outPath;
}

// Freeze-pads (holds the last frame) a finished visual segment out to
// targetDuration when the scene's voice track runs longer than the picture
// itself — the picture is primary now, but narration/dialogue still never
// gets cut short to fit it (same value judgment the old target-duration trim
// logic made, just applied in the other direction).
async function padVisualToMatch(visualPath: string, workDir: string, index: number, targetDuration: number, currentDuration: number): Promise<string> {
  if (targetDuration <= currentDuration + DURATION_TOLERANCE_SECONDS) return visualPath;
  const outPath = path.join(workDir, `scene${index}-visual-padded.mp4`);
  const pad = (targetDuration - currentDuration).toFixed(3);
  await runFfmpeg(["-i", visualPath, "-vf", `tpad=stop_mode=clone:stop_duration=${pad}`, "-pix_fmt", "yuv420p", "-t", targetDuration.toFixed(3), "-an", outPath]);
  return outPath;
}

// Pads the voice track with trailing silence out to targetDuration — a
// no-op-equivalent trim when it's already exactly that long, since apad+`-t`
// handles both cases in one ffmpeg call (same idiom buildAmbienceLayer below
// already uses for music/sfx).
async function padVoiceToMatch(voicePath: string, workDir: string, index: number, targetDuration: number): Promise<string> {
  const outPath = path.join(workDir, `scene${index}-voice-padded.wav`);
  await runFfmpeg(["-i", voicePath, "-af", "apad", "-t", targetDuration.toFixed(3), "-ar", String(AUDIO_RATE), "-ac", "2", outPath]);
  return outPath;
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
  const { path: rawVisualPath, clipPath } = await buildVisualSegment(scene, workDir, index, FULL_RES);
  const visualDuration = await probeDuration(rawVisualPath);

  const voicePath = await buildSceneVoiceTrack(scene, workDir, index);
  const voiceDuration = voicePath ? await probeDuration(voicePath) : 0;

  // The picture is authoritative (native clip length / shot durations) —
  // voice is fit to it, extending the picture only if voice runs longer
  // than the picture it was cue-planned/written against.
  const finalDuration = Math.max(visualDuration, voiceDuration);
  const visualPath = await padVisualToMatch(rawVisualPath, workDir, index, finalDuration, visualDuration);

  const layers: string[] = [];
  if (voicePath) layers.push(await padVoiceToMatch(voicePath, workDir, index, finalDuration));
  if (clipPath && includeClipAudio) {
    const clipAudioPath = await extractClipAudioLayer(clipPath, workDir, `scene${index}-clipaudio`, finalDuration);
    if (clipAudioPath) layers.push(clipAudioPath);
  }
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

// Same job as concatSegments, but joins every pair of consecutive segments
// with a short audio+video crossfade (ffmpeg's xfade/acrossfade) instead of
// a hard cut. Every segment already shares FULL_RES's exact
// resolution/fps/pix_fmt and AUDIO_RATE's exact sample rate/channel layout
// (buildSceneSegment/muxSceneSegment guarantee it), which xfade/acrossfade
// require — mismatched inputs would fail or behave oddly. Unlike
// concatSegments this always re-encodes (xfade can't stream-copy), which is
// the real reason the two stay separate functions: assembleSilentPicture
// doesn't need this — it's read by a video-understanding model that cares
// about pacing/content, not transition polish — and re-encoding a 9-minute
// cue-plan render wasn't worth adding on that path.
async function crossfadeConcatSegments(segmentPaths: string[], workDir: string, outPath: string): Promise<void> {
  if (segmentPaths.length === 1) {
    await fs.copyFile(segmentPaths[0], outPath);
    return;
  }

  const durations = await Promise.all(segmentPaths.map((p) => probeDuration(p)));

  const filterParts: string[] = [];
  let videoLabel = "0:v";
  let audioLabel = "0:a";
  let runningDuration = durations[0];

  for (let i = 1; i < segmentPaths.length; i++) {
    // Clamp so the overlap never exceeds half of either neighboring
    // segment's own length — otherwise xfade's offset could land before the
    // start of the running stream.
    const d = Math.max(
      Math.min(SCENE_TRANSITION_SECONDS, runningDuration / 2, durations[i] / 2),
      MIN_TRANSITION_SECONDS
    );
    const offset = Math.max(runningDuration - d, 0);
    const vOut = `v${i}`;
    const aOut = `a${i}`;
    filterParts.push(
      `[${videoLabel}][${i}:v]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`
    );
    filterParts.push(`[${audioLabel}][${i}:a]acrossfade=d=${d.toFixed(3)}[${aOut}]`);
    videoLabel = vOut;
    audioLabel = aOut;
    runningDuration = runningDuration + durations[i] - d;
  }

  const inputArgs = segmentPaths.flatMap((p) => ["-i", p]);
  await runFfmpeg([
    ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", `[${videoLabel}]`,
    "-map", `[${audioLabel}]`,
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-ar", String(AUDIO_RATE),
    outPath,
  ]);
}

// Shared by assembleVideo and assembleSilentPicture below — every scene
// needs a selected visual (image per shot, or a clip) before either can
// build anything; reports every unready scene at once rather than stopping
// at the first.
async function loadReadyScenes(parentType: ScenesParentType, parentId: string): Promise<AssemblyScene[]> {
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

  return scenes;
}

export interface SceneManifestEntry {
  sceneId: string;
  order: number;
  title: string | null;
  startSeconds: number;
  durationSeconds: number;
  characterNames: string[];
  narration: string | null;
  dialogueLines: { character: string; text: string }[];
  musicPrompt: string | null;
  sfxPrompt: string | null;
}

export interface SilentPicture {
  base64: string;
  mimeType: string;
  manifest: SceneManifestEntry[];
}

// Phase 11 — the picture, assembled alone (no narration/dialogue/music/sfx),
// for the Audio Cue Plan step (lib/audio-cue-plan.ts) to watch. Reuses
// buildVisualSegment directly — the same native/explicit-duration segment
// buildSceneSegment builds as its first step for the real final assembly —
// so the timeline a cue plan is drafted against is exactly the timeline the
// real assembly will produce, not a separate approximation of it.
export async function assembleSilentPicture(parentType: ScenesParentType, parentId: string): Promise<SilentPicture> {
  const scenes = await loadReadyScenes(parentType, parentId);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-silent-"));
  try {
    const manifest: SceneManifestEntry[] = [];
    const segmentPaths: string[] = [];
    let cursor = 0;
    for (const [index, scene] of scenes.entries()) {
      const { path: visualPath } = await buildVisualSegment(scene, workDir, index, CUE_PLAN_RES);
      const durationSeconds = await probeDuration(visualPath);
      segmentPaths.push(visualPath);
      manifest.push({
        sceneId: scene.id,
        order: scene.order,
        title: scene.title,
        startSeconds: cursor,
        durationSeconds,
        characterNames: scene.characters.map((c) => c.name),
        narration: scene.narration,
        dialogueLines: scene.dialogueLines.map((l) => ({ character: l.character.name, text: l.text })),
        musicPrompt: scene.musicPrompt,
        sfxPrompt: scene.sfxPrompt,
      });
      cursor += durationSeconds;
    }

    const finalPath = path.join(workDir, "silent.mp4");
    await concatSegments(segmentPaths, workDir, finalPath);
    const buffer = await fs.readFile(finalPath);
    return { base64: buffer.toString("base64"), mimeType: "video/mp4", manifest };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
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
  const scenes = await loadReadyScenes(parentType, parentId);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-assembly-"));
  try {
    const segmentPaths: string[] = [];
    for (const [index, scene] of scenes.entries()) {
      segmentPaths.push(await buildSceneSegment(scene, workDir, index, includeClipAudio));
    }

    const finalPath = path.join(workDir, "final.mp4");
    await crossfadeConcatSegments(segmentPaths, workDir, finalPath);

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
