import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma, type Asset, type Prisma, type CameraMovement } from "@/lib/db";
import { parentWhere, type ScenesParentType } from "@/lib/scenes";
import { runFfmpeg, probeDuration, probeFps, hasAudioStream } from "@/lib/ffmpeg";
import { storage, buildStorageKey } from "@/lib/storage";
import { effectiveShotSeconds, MIN_SHOT_SECONDS } from "@/lib/illustration-timing";
import {
  analyzeMouthIntervals,
  detectMouthBox,
  flapRenderBlockedReason,
  mapVoiceItemsToShots,
  mouthCompositeFilter,
  mouthOpenEnableExpression,
  mouthOpenKey,
  type MouthBox,
  type MouthInterval,
} from "@/lib/mouth-flap";
import { STALE_MS } from "@/lib/generation-claims";
import { recordGenerationEvent, resolveParentProjectId } from "@/lib/generation-events";

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

function scalePadFilter({ width, height, fps }: VisualTarget): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;
}

// Same scale/pad as scalePadFilter, but without its trailing fps= stage —
// used only for real generated clips (buildVisualSegment's needsClip branch),
// where the frame-rate stage is decided per-clip by frameRateFilter below
// instead of always being a plain fps conversion. ILLUSTRATION's Ken Burns
// output has no "native fps" to speak of (it's synthesized by ffmpeg
// directly at the target rate), so it keeps using scalePadFilter unchanged.
function scalePadOnlyFilter({ width, height }: Pick<VisualTarget, "width" | "height">): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

// Many image-to-video providers output well below the assembly's 30fps
// target (8-16fps is common) — plain frame duplication (ffmpeg's `fps`
// filter) still hits the target rate but stays visibly choppy. minterpolate
// does true motion-compensated interpolation instead, at real CPU cost and
// with some risk of ghosting/warping on fast or complex motion, so it's only
// used when the source is meaningfully below target; a clip already close to
// 30fps gets the cheap, artifact-free conversion it always got.
const LOW_FPS_INTERPOLATION_THRESHOLD = 20;

function frameRateFilter(sourceFps: number, targetFps: number): string {
  if (sourceFps >= LOW_FPS_INTERPOLATION_THRESHOLD) return `fps=${targetFps}`;
  return `minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
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
// HANDHELD drift, in source pixels. The available travel at PAN_ZOOM is
// iw*(1-1/1.15) ≈ 13% of width (~250px at 1920), so ±6px is roughly 5% of
// the pan range — visible as unsteadiness, nowhere near a pan, and it can
// never reach the frame edge. The two periods are coprime-ish on purpose so
// x and y don't resynchronize into a visible repeating loop.
const HANDHELD_AMPLITUDE_PX = 6;
const HANDHELD_PERIOD_X = 7;
const HANDHELD_PERIOD_Y = 11;
// ROLL sweeps from -3° to +3° across the shot (0.0524 rad ≈ 3°). Kept small:
// the rotation happens on the 2x prescale canvas and is centre-cropped back to
// target, so a much larger angle would still be safe geometrically, but a roll
// beyond a few degrees on an establishing still reads as a mistake rather than
// as unease.
const ROLL_MAX_RADIANS = 0.0524;

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
    case "TILT_UP":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;
    case "TILT_DOWN":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(on/${lastFrame})':${zoompanTail}`;

    // Dolly and track/crane deliberately reuse the zoom and pan transforms.
    // The source here is ONE still image, so there is no parallax to move
    // through: a physical push-in and an optical zoom collapse to the same
    // affine scale, and lateral/vertical travel collapses to the same
    // translation as a pan. They stay distinct enum values because the
    // IMAGE_TO_VIDEO path (cameraMovementInstruction, scene-video.ts) sends
    // them to a video model that CAN render the difference — so if these
    // look identical in an ILLUSTRATION render, that's the flat source
    // image, not a missing mapping.
    case "DOLLY_IN":
      return `${prescale},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "DOLLY_OUT":
      return `${prescale},zoompan=z='if(eq(on,0),${ZOOM_MAX},max(zoom-${ZOOM_STEP_PER_FRAME},1))':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "TRACK_LEFT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(1-on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "TRACK_RIGHT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "CRANE_UP":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;
    case "CRANE_DOWN":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(on/${lastFrame})':${zoompanTail}`;

    // Handheld is the one new value with a genuinely different shape, so it
    // gets a real filter rather than falling back to STATIC: two sine
    // offsets at deliberately unequal periods (so the path never repeats
    // into an obvious circle or figure-8), riding the same PAN_ZOOM headroom
    // the pans use so the drift never exposes the source's edge. zoompan
    // quantizes x/y to integers, which here is a feature — the quantization
    // reads as micro-shake rather than a glassy-smooth glide.
    case "HANDHELD":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)/2+${HANDHELD_AMPLITUDE_PX}*sin(on/${HANDHELD_PERIOD_X})':y='(ih-ih/zoom)/2+${HANDHELD_AMPLITUDE_PX}*sin(on/${HANDHELD_PERIOD_Y})':${zoompanTail}`;

    // ROLL is the one addition with an EXACT still-image equivalent: rolling
    // the camera around the lens axis really is just rotating a flat image,
    // no parallax required. So it gets a real rotate rather than a stand-in.
    // Rotation happens on the 2x prescaled canvas and is then centre-cropped
    // to target, so the corners swept in by the rotation are far outside the
    // crop and never show as black wedges.
    case "ROLL":
      return `${prescale},rotate=a='${ROLL_MAX_RADIANS}*(2*n/${lastFrame}-1)':c=black,crop=${target.width}:${target.height},fps=${target.fps}`;

    // Speed-variant zooms. Ken Burns has no concept of speed — the whole
    // move is linear across the shot's duration — so these render as their
    // plain counterparts here. The speed is carried on the IMAGE_TO_VIDEO
    // path instead (cameraMovementInstruction, scene-video.ts), where the
    // model can actually act on "fast"/"snap".
    case "CRASH_ZOOM":
      return `${prescale},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;
    case "WHIP_PAN":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(on/${lastFrame})':y='${centerY}':${zoompanTail}`;

    // DOLLY_ZOOM's entire effect is the subject holding size while the
    // background scale changes behind them — that needs depth separation,
    // which a single flat image doesn't have. Renders as a plain push-in;
    // the real effect only exists on the IMAGE_TO_VIDEO path.
    case "DOLLY_ZOOM":
      return `${prescale},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;

    // Pedestal is pure vertical translation, which on a flat plane is the
    // same transform as a crane's vertical component.
    case "PEDESTAL_UP":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;
    case "PEDESTAL_DOWN":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(on/${lastFrame})':${zoompanTail}`;

    // An arc orbits the subject, which requires seeing around them — there is
    // no "around" in a flat image, so it degrades to the lateral travel that
    // an orbit reads as from the front.
    case "ARC_LEFT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(1-on/${lastFrame})':y='${centerY}':${zoompanTail}`;
    case "ARC_RIGHT":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='(iw-iw/zoom)*(on/${lastFrame})':y='${centerY}':${zoompanTail}`;

    // A steadicam follow reads as gliding forward with the subject, so a slow
    // push-in is the closest flat-image equivalent — smooth by construction,
    // which is exactly what distinguishes it from HANDHELD above.
    case "STEADICAM_FOLLOW":
      return `${prescale},zoompan=z='min(zoom+${ZOOM_STEP_PER_FRAME},${ZOOM_MAX})':x='${centerX}':y='${centerY}':${zoompanTail}`;

    // AERIAL describes a vantage rather than a motion vector. A drone shot
    // over a still most often reads as a slow rising reveal, so it borrows
    // the crane-up transform.
    case "AERIAL":
      return `${prescale},zoompan=z=${PAN_ZOOM}:x='${centerX}':y='(ih-ih/zoom)*(1-on/${lastFrame})':${zoompanTail}`;

    default: {
      // Compile-time exhaustiveness: adding a CameraMovement value without a
      // filter here is a type error, not a silent fall-through to a static
      // frame that would look like the feature simply didn't work.
      const unhandled: never = movement;
      void unhandled;
      return scalePadFilter(target);
    }
  }
}

export interface SerializedFinalVideo {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
  fileName: string | null;
  sizeBytes: number | null;
  // Dubbing — null for the project's own primary-language render, an
  // INDIAN_LANGUAGES value for a dub render. See Asset.language in
  // schema.prisma.
  language: string | null;
}

export function serializeFinalVideo(asset: Asset): SerializedFinalVideo {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
    fileName: asset.fileName,
    sizeBytes: asset.sizeBytes,
    language: asset.language,
  };
}

function parentVideoWhere(parentType: ScenesParentType, parentId: string): Prisma.AssetWhereInput {
  return parentType === "story" ? { storyVideoId: parentId } : { episodeVideoId: parentId };
}

// Same claim/release contract as claimShotForImageGeneration in
// shot-images.ts, parameterized over the dual-optional Story/Episode parent
// (same pattern as parentVideoWhere above) since both assembly jobs are
// single-instance-per-parent, not per-scene.
async function claimAssembly(
  field: "silentVideoGenerationStartedAt" | "finalVideoGenerationStartedAt",
  parentType: ScenesParentType,
  parentId: string,
  staleMs: number
): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - staleMs);
  const where = { id: parentId, OR: [{ [field]: null }, { [field]: { lt: staleThreshold } }] };
  const data = { [field]: new Date() };
  const result =
    parentType === "story"
      ? await prisma.story.updateMany({ where, data })
      : await prisma.episode.updateMany({ where, data });
  return result.count > 0;
}

async function releaseAssembly(
  field: "silentVideoGenerationStartedAt" | "finalVideoGenerationStartedAt",
  parentType: ScenesParentType,
  parentId: string
): Promise<void> {
  const data = { [field]: null };
  if (parentType === "story") await prisma.story.update({ where: { id: parentId }, data });
  else await prisma.episode.update({ where: { id: parentId }, data });
}

export function claimSilentAssembly(parentType: ScenesParentType, parentId: string) {
  return claimAssembly("silentVideoGenerationStartedAt", parentType, parentId, STALE_MS.silentAssembly);
}
export function releaseSilentAssembly(parentType: ScenesParentType, parentId: string) {
  return releaseAssembly("silentVideoGenerationStartedAt", parentType, parentId);
}
export function claimFinalAssembly(parentType: ScenesParentType, parentId: string) {
  return claimAssembly("finalVideoGenerationStartedAt", parentType, parentId, STALE_MS.finalAssembly);
}
export function releaseFinalAssembly(parentType: ScenesParentType, parentId: string) {
  return releaseAssembly("finalVideoGenerationStartedAt", parentType, parentId);
}

function belongsToParent(asset: Asset, parentType: ScenesParentType, parentId: string): boolean {
  return parentType === "story" ? asset.storyVideoId === parentId : asset.episodeVideoId === parentId;
}

function parentSilentVideoWhere(parentType: ScenesParentType, parentId: string): Prisma.AssetWhereInput {
  return parentType === "story" ? { storySilentVideoId: parentId } : { episodeSilentVideoId: parentId };
}

function belongsToSilentParent(asset: Asset, parentType: ScenesParentType, parentId: string): boolean {
  return parentType === "story" ? asset.storySilentVideoId === parentId : asset.episodeSilentVideoId === parentId;
}

// A function, not a static object — narrationAudio/dialogueLines[].audio's
// `isSelected: true` is no longer unique per scene now that dubbing exists
// (each language gets its own independently-selected take, see
// lib/voice.ts's selectNarrationAudio), so the query must also filter by
// which language's take this render wants. `language: null` (the default,
// every render before dubbing existed) means the project's own primary
// language. music/sfx stay unfiltered by language — those are never
// generated per-language, the same bed/effect plays under every dub.
function assemblySceneInclude(language: string | null) {
  return {
    shots: {
      orderBy: { order: "asc" as const },
      include: { images: { where: { isSelected: true }, take: 1 } },
    },
    // No `take: 1` — a scene's selected take can be several frame-chained
    // segments (see Asset.videoBatchId/videoSegmentOrder in scene-video.ts),
    // all sharing isSelected: true, ordered so buildVisualSegment can
    // concatenate them back into one continuous clip.
    videoClips: { where: { isSelected: true }, orderBy: { videoSegmentOrder: "asc" as const } },
    narrationAudio: { where: { isSelected: true, language }, take: 1 },
    dialogueLines: {
      orderBy: { order: "asc" as const },
      include: {
        audio: { where: { isSelected: true, language }, take: 1 },
        // Only needed by generateSilentAssembly's cue-plan manifest below
        // (buildSceneVoiceTrack ignores it) — included here rather than a
        // second scene include so both passes share one query shape.
        character: { select: { name: true } },
      },
    },
    // Same reasoning as dialogueLines.character above — only read by
    // generateSilentAssembly, for the cue-planning prompt's per-scene roster.
    characters: { select: { name: true } },
    music: { where: { isSelected: true }, take: 1 },
    sfx: { where: { isSelected: true }, take: 1 },
  } satisfies Prisma.SceneInclude;
}

type AssemblyScene = Prisma.SceneGetPayload<{ include: ReturnType<typeof assemblySceneInclude> }>;

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
// each shot's duration is its own — an explicit Shot.durationSeconds, or
// DEFAULT_ILLUSTRATION_SECONDS when unset (effectiveShotSeconds, shared with
// shot-manager.tsx's hint — see lib/illustration-timing.ts) — rather than
// splitting a scene-level total. That per-shot number is the *authored
// pacing* (which shot gets more screen time relative to the others), not the
// final render length: when `scaleToSeconds` is given (buildSceneSegment
// passes the scene's real, just-generated voice-track duration whenever one
// exists), every shot is stretched or compressed by the same ratio so the
// picture's total lands exactly on it — no freeze-frame hold or trailing
// silence needed to reconcile picture and voice, they're the same number by
// construction. null (no voice yet, e.g. generateSilentAssembly) keeps each
// shot at its own natural, unscaled duration.
// 2D mouth flap (see lib/mouth-flap.ts). Only when the scene's shots line up
// one-to-one with its voice takes: each shot then lasts exactly as long as
// its own take (instead of the authored/proportional shot length), and a
// speaking shot that has an open-mouth twin swaps to it by that take's
// loudness. Returns null — leaving the render on the existing proportional
// timing, byte for byte — whenever the mapping isn't exact.
interface MouthFlapPlan {
  takeSeconds: number[];
  flaps: (MouthFlap | null)[];
}

interface MouthFlap {
  baseImagePath: string;
  openImagePath: string;
  // Only this region of the twin is composited back. See detectMouthBox —
  // swapping the whole frame made the background twitch with the mouth,
  // because the twin is a whole-frame regeneration rather than a mouth edit.
  box: MouthBox;
  intervals: MouthInterval[];
}

async function planMouthFlap(scene: AssemblyScene, workDir: string, index: number): Promise<MouthFlapPlan | null> {
  const items = mapVoiceItemsToShots(scene);
  if (!items) return null;
  // Shared with the scene voice panel's readiness check, so the two can't
  // disagree about whether this scene will actually flap.
  if (flapRenderBlockedReason(scene, items)) return null;
  const narrationExpected = items[0].kind === "narration";

  // Cheapest gate first. Take-length shot timing exists only to line the
  // picture up with the flap, so a scene with no twin anywhere must stay on
  // its authored per-shot durations — otherwise merely having one shot per
  // line would silently throw away the pacing the user set, in scenes that
  // never opted into Talking Frames at all.
  const hasTwin = await Promise.all(
    items.map(async (item, i) =>
      item.kind === "dialogue"
        ? Boolean(await storage.stat(mouthOpenKey(scene.shots[i].id, scene.shots[i].images[0].id)))
        : false
    )
  );
  if (!hasTwin.some(Boolean)) return null;

  const takes = [...(narrationExpected ? [scene.narrationAudio[0]] : []), ...scene.dialogueLines.map((line) => line.audio[0])];
  const takePaths = await Promise.all(takes.map((take, i) => writeAssetToTemp(take, workDir, `scene${index}-flaptake${i}`)));
  const takeSeconds = await Promise.all(takePaths.map((p) => probeDuration(p)));

  const flaps = await Promise.all(
    items.map(async (item, i) => {
      if (!hasTwin[i]) return null;
      const shot = scene.shots[i];
      const openBytes = await storage.get(mouthOpenKey(shot.id, shot.images[0].id));
      if (!openBytes) return null;
      const intervals = await analyzeMouthIntervals(takePaths[i]);
      if (intervals.length === 0) return null;
      const openImagePath = path.join(workDir, `scene${index}-shot${i}-open.png`);
      await fs.writeFile(openImagePath, openBytes);
      const baseImagePath = await writeAssetToTemp(shot.images[0], workDir, `scene${index}-shot${i}-image`);
      // No localized change means the twin isn't a mouth edit of this still
      // (the model reframed or redrew it). Leaving the shot un-flapped keeps
      // it a clean still rather than swapping in a picture that doesn't match.
      const box = await detectMouthBox(baseImagePath, openImagePath);
      if (!box) return null;
      return { baseImagePath, openImagePath, box, intervals };
    })
  );
  // Twins existed but none survived (no speech detected, or no localized
  // change to composite) — same reasoning as the hasTwin gate above.
  if (!flaps.some(Boolean)) return null;
  return { takeSeconds, flaps };
}

async function buildIllustrationSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  outPath: string,
  target: VisualTarget,
  scaleToSeconds: number | null
): Promise<string> {
  const shots = scene.shots;
  // Only planned when the picture is being fit to a real voice track — the
  // silent assembly (scaleToSeconds null) has nothing to time or flap against.
  const mouthPlan = scaleToSeconds != null ? await planMouthFlap(scene, workDir, index) : null;
  const naturalDurations = mouthPlan ? mouthPlan.takeSeconds : shots.map((shot) => effectiveShotSeconds(shot.durationSeconds));
  const naturalTotal = naturalDurations.reduce((sum, d) => sum + d, 0);
  const scale = scaleToSeconds != null && naturalTotal > 0 ? scaleToSeconds / naturalTotal : 1;

  const shotPaths: string[] = [];
  for (const [i, shot] of shots.entries()) {
    const shotDuration = Math.max(naturalDurations[i] * scale, MIN_SHOT_SECONDS);
    const shotPath = path.join(workDir, `scene${index}-shot${i}.mp4`);
    const flap = mouthPlan?.flaps[i] ?? null;
    const imagePath = flap?.baseImagePath ?? (await writeAssetToTemp(shot.images[0], workDir, `scene${index}-shot${i}-image`));
    const frames = Math.max(Math.round(shotDuration * target.fps), 1);
    if (flap) {
      const camera = buildCameraFilter(shot.cameraMovement, frames, target);
      const enable = mouthOpenEnableExpression(flap.intervals, scale);
      // Composite the mouth in source coordinates first, then move the
      // camera over the finished picture — so the box stays valid whatever
      // the framing, and the camera runs once instead of on both copies.
      await runFfmpeg([
        "-loop", "1",
        "-i", imagePath,
        "-loop", "1",
        "-i", flap.openImagePath,
        "-t", shotDuration.toFixed(3),
        "-filter_complex", `${mouthCompositeFilter(flap.box, enable, "flapped")};[flapped]${camera},format=yuv420p[v]`,
        "-map", "[v]",
        "-an",
        shotPath,
      ]);
    } else {
      await runFfmpeg([
        "-loop", "1",
        "-i", imagePath,
        "-t", shotDuration.toFixed(3),
        "-vf", buildCameraFilter(shot.cameraMovement, frames, target),
        "-pix_fmt", "yuv420p",
        "-an",
        shotPath,
      ]);
    }
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

// Silent, normalized visual segment. IMAGE_TO_VIDEO/TEXT_TO_VIDEO scenes use
// the clip's own native length always — a real generated video clip can't be
// time-scaled without regenerating it or visibly speed-ramping it, so
// `scaleToSeconds` is ignored for them. ILLUSTRATION shots use their own
// durationSeconds, scaled to `scaleToSeconds` when given (see
// buildIllustrationSegment) — from generateSilentAssembly (no voice exists
// yet) this is always null, so cue planning still gets each shot's natural,
// unscaled length to draft narration against; from assembleVideo's
// buildSceneSegment it's the scene's actual voice-track duration whenever
// one exists, so the rendered picture and voice always land on the same
// number instead of one padding to cover the other.
async function buildVisualSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  target: VisualTarget,
  scaleToSeconds: number | null
): Promise<VisualSegmentResult> {
  const outPath = path.join(workDir, `scene${index}-visual.mp4`);
  const needsClip = scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO";

  if (!needsClip) {
    return { path: await buildIllustrationSegment(scene, workDir, index, outPath, target, scaleToSeconds), clipPath: null };
  }

  const clipPath = await resolveSceneClipPath(scene.videoClips, workDir, index);
  // A probe failure (corrupt/unusual file) falls back to treating the source
  // as already at-target-fps — skips interpolation rather than blocking the
  // whole scene's assembly on a smoothness nice-to-have.
  const sourceFps = await probeFps(clipPath).catch(() => target.fps);
  const visualFilter = `${scalePadOnlyFilter(target)},${frameRateFilter(sourceFps, target.fps)}`;
  await runFfmpeg(["-i", clipPath, "-vf", visualFilter, "-pix_fmt", "yuv420p", "-an", outPath]);
  return { path: outPath, clipPath };
}

// Per-frame color normalization (stretches each frame's own range toward a
// shared black/white point, channels locked together via independence=0 so
// it corrects exposure/contrast without shifting color balance/tint) applied
// wherever independently-generated clips get concatenated. smoothing=0
// disables temporal blending so it reacts instantly at a cut instead of
// bleeding across it — each clip is normalized on its own terms, not toward
// its neighbor. This is a real but modest fix for the common "one clip came
// back washed-out/dark next to a normal one" case; it does not do true
// pairwise tone-matching between clips (see the comment on
// resolveSceneClipPath below for why that's out of scope here).
const COLOR_NORMALIZE_FILTER = "normalize=smoothing=0:independence=0";

// A scene's selected take may be one clip (legacy/single-segment) or several
// frame-chained segments generated by one call (see Asset.videoBatchId).
// Multi-segment batches are concatenated — preserving each segment's own
// audio track, not just video — into one raw clip first, so downstream code
// (the scale/pad step above, and extractClipAudioLayer below) can keep
// treating "this scene's clip" as a single file. Re-encodes rather than
// `-c copy`: independently generated segments aren't guaranteed to share
// identical codec parameters. This is also the more visible seam than
// scene-to-scene cuts (see crossfadeConcatSegments) — these are hard cuts
// with zero smoothing at all between shot-pair clips inside one scene, so
// COLOR_NORMALIZE_FILTER is applied here rather than attempting true
// pairwise color-matching (which would need per-clip stats extraction and a
// switch from this concat demuxer to a filter-graph concat — real new
// surface area for a per-clip fix that's already "good enough" here).
async function resolveSceneClipPath(clips: Asset[], workDir: string, index: number): Promise<string> {
  if (clips.length <= 1) {
    return writeAssetToTemp(clips[0], workDir, `scene${index}-clip`);
  }
  const rawPaths = await Promise.all(clips.map((clip, i) => writeAssetToTemp(clip, workDir, `scene${index}-clip${i}-raw`)));
  const listPath = path.join(workDir, `scene${index}-clips-list.txt`);
  await fs.writeFile(listPath, concatListFile(rawPaths));
  const outPath = path.join(workDir, `scene${index}-clip-concat.mp4`);
  await runFfmpeg([
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-vf", COLOR_NORMALIZE_FILTER,
    "-pix_fmt", "yuv420p",
    outPath,
  ]);
  return outPath;
}

// Freeze-pads (holds the last frame) a finished visual segment out to
// targetDuration when it's still shorter — narration/dialogue never gets cut
// short to fit the picture. For ILLUSTRATION with a voice track, the picture
// was already built scaled to that same voice duration (see
// buildIllustrationSegment's scaleToSeconds), so this is normally a no-op
// past DURATION_TOLERANCE_SECONDS, just mopping up sub-frame rounding, not
// doing the real reconciling work. It still does real work for
// IMAGE_TO_VIDEO/TEXT_TO_VIDEO (native clip length can't be rescaled the same
// way) and for ILLUSTRATION scenes with no voice track at all.
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

// Sound Engineer (AUDIO_MIXING_PLANNING) — an optional music fade at the
// scene's own boundaries, from Scene.musicFadeInSeconds/musicFadeOutSeconds.
// Both null/0 (the default, and every scene rendered before this existed)
// returns an empty list, so the filter chain below is byte-for-byte the one
// it always was. Each fade is clamped to the scene's own duration so a
// nonsense value (an AI proposal, or a hand-typed one) can only ever produce
// a fade covering the whole scene, never an `afade` starting before 0 or
// after the stream ends — which ffmpeg would accept silently and render as
// no fade at all, or as silence.
function musicFadeFilters(duration: number, fadeIn: number | null, fadeOut: number | null): string[] {
  const filters: string[] = [];
  const inSeconds = fadeIn != null && fadeIn > 0 ? Math.min(fadeIn, duration) : 0;
  const outSeconds = fadeOut != null && fadeOut > 0 ? Math.min(fadeOut, duration) : 0;
  if (inSeconds > 0) {
    filters.push(`afade=t=in:st=0:d=${inSeconds.toFixed(3)}`);
  }
  if (outSeconds > 0) {
    filters.push(`afade=t=out:st=${Math.max(duration - outSeconds, 0).toFixed(3)}:d=${outSeconds.toFixed(3)}`);
  }
  return filters;
}

// Loops (music) or pads-with-silence (sfx) a single asset to exactly
// `duration` seconds with `volume` applied, so it can be layered under the
// scene's voice track. Looping suits a music bed shorter than the scene;
// padding suits a one-shot sound effect — looping a sound effect would sound
// like a glitch, not ambience.
//
// `fadeIn`/`fadeOut` are the Sound Engineer's optional music fades (see
// musicFadeFilters above); sfx never passes them. They're appended AFTER
// `apad` deliberately: a fade-out is positioned relative to the stream's
// final length, which for the padded sfx case is the padded length, not the
// source's own. For looped music `apad` isn't in the chain at all (an
// infinitely looped stream is trimmed by `-t` instead), so ordering is moot
// there.
async function buildAmbienceLayer(
  asset: Asset,
  workDir: string,
  name: string,
  duration: number,
  volume: number,
  loop: boolean,
  fadeIn: number | null = null,
  fadeOut: number | null = null
): Promise<string> {
  const srcPath = await writeAssetToTemp(asset, workDir, `${name}-src`);
  const outPath = path.join(workDir, `${name}.wav`);
  const durationStr = duration.toFixed(3);
  const filterChain = [`volume=${volume}`, ...(loop ? [] : ["apad"]), ...musicFadeFilters(duration, fadeIn, fadeOut)].join(",");
  await runFfmpeg([
    ...(loop ? ["-stream_loop", "-1"] : []),
    "-i", srcPath,
    "-af", filterChain,
    "-t", durationStr,
    "-ar", String(AUDIO_RATE),
    "-ac", "2",
    outPath,
  ]);
  return outPath;
}

// Sound Engineer (AUDIO_MIXING_PLANNING) — ffmpeg's sidechaincompress, keyed
// off the scene's voice track, so the music bed dips while someone is
// speaking and recovers in the gaps rather than sitting at one permanently
// low level for the whole scene (which is all Scene.musicVolume alone can do).
//
// Input order is load-bearing and easy to get backwards: sidechaincompress
// takes the signal to be compressed FIRST and the signal that triggers the
// compression SECOND, so [0:a] must be the music and [1:a] the voice.
// Swapping them silently produces a valid render in which the *dialogue*
// ducks under the music — exactly the problem this step exists to fix.
//
// Deliberately its own pass rather than folded into mixAudioLayers' amix
// graph: this needs exactly two named, related streams, whereas
// mixAudioLayers takes a variable-length list whose members come and go per
// scene (no voice, no music, optional sfx, optional clip audio). Wiring a
// two-input filter into that positional list would mean index bookkeeping
// that breaks quietly the first time a layer is absent. The intermediate is
// PCM wav, so the extra hop is lossless — and every scene that isn't ducking
// skips this function entirely and reaches the untouched amix stage exactly
// as before.
//
// Both inputs are already exactly `duration` seconds long by construction
// (buildAmbienceLayer's `-t`, padVoiceToMatch's apad+`-t`); `-t` here is a
// belt-and-braces guard so a framesync edge case can't hand back a layer of
// a different length than the other layers amix is about to mix it with.
// Tuned against measured output, not picked off a defaults list — an earlier
// threshold of 0.1 measured as a 0.4 dB duck, i.e. nothing. sidechaincompress
// compares the sidechain's RMS level against `threshold` in LINEAR amplitude,
// and reduces the main input by (1 - 1/ratio) × (however many dB the sidechain
// overshoots). Generated speech sits around -18 dBFS RMS (≈ 0.126 linear), so
// a threshold anywhere near 0.1 leaves almost no overshoot to act on.
//
// 0.02 (≈ -34 dBFS) with ratio 3 measures ~12 dB of reduction under normal
// speech, ~4 dB under an unusually quiet line and ~16 dB under a loud one —
// a duck a listener reads as "the music got out of the way", not as the music
// being muted and un-muted. A threshold this low is only safe because the
// voice track is generated TTS concatenated with digital silence (see
// buildSceneVoiceTrack/padVoiceToMatch): there's no room tone or breath in
// the gaps to trigger it, which is what would otherwise make the bed pump.
const DUCK_THRESHOLD = 0.02;
const DUCK_RATIO = 3;
const DUCK_ATTACK_MS = 20; // fast enough to catch a line's first syllable
const DUCK_RELEASE_MS = 400; // slow enough not to pump between words
async function duckMusicUnderVoice(
  musicPath: string,
  voicePath: string,
  workDir: string,
  name: string,
  duration: number
): Promise<string> {
  const outPath = path.join(workDir, `${name}-ducked.wav`);
  await runFfmpeg([
    "-i", musicPath,
    "-i", voicePath,
    "-filter_complex",
    `[0:a][1:a]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}:makeup=1[ducked]`,
    "-map", "[ducked]",
    "-t", duration.toFixed(3),
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

interface SceneSegmentResult {
  path: string;
  // The segment's real rendered length — already computed here as
  // `finalDuration`, returned so assembleVideo can record an accurate
  // per-scene timeline on the final Asset's metadata (what the Sound
  // Engineer pass later reads) without re-probing every segment.
  durationSeconds: number;
  // Which layers this scene's mix actually ended up containing, and the
  // parameters it was rendered with. Also purely for that manifest: telling
  // the Sound Engineer "this scene has music at 0.25 with no ducking" is the
  // difference between it critiquing the mix and it guessing at one.
  hasVoice: boolean;
  hasMusic: boolean;
  hasSfx: boolean;
}

async function buildSceneSegment(
  scene: AssemblyScene,
  workDir: string,
  index: number,
  includeClipAudio: boolean
): Promise<SceneSegmentResult> {
  const voicePath = await buildSceneVoiceTrack(scene, workDir, index);
  const voiceDuration = voicePath ? await probeDuration(voicePath) : 0;

  // ILLUSTRATION with a real voice track: scale the picture to that exact
  // duration up front (see buildIllustrationSegment) so visual and voice are
  // the same number by construction, instead of building the picture at its
  // own natural length and reconciling afterward. Everything else (no voice
  // yet, or a real generated IMAGE_TO_VIDEO/TEXT_TO_VIDEO clip that can't be
  // rescaled without regenerating it) keeps the picture's natural length —
  // the padding below is what reconciles those cases.
  const scaleToSeconds = scene.visualMode === "ILLUSTRATION" && voiceDuration > 0 ? voiceDuration : null;
  const { path: rawVisualPath, clipPath } = await buildVisualSegment(scene, workDir, index, FULL_RES, scaleToSeconds);
  const visualDuration = await probeDuration(rawVisualPath);

  const finalDuration = Math.max(visualDuration, voiceDuration);
  const visualPath = await padVisualToMatch(rawVisualPath, workDir, index, finalDuration, visualDuration);

  const layers: string[] = [];
  // Kept as its own binding, not just pushed into `layers`: it's also the
  // sidechain key for ducking below, and "the voice layer" has to stay
  // identifiable once clip audio/music/sfx are in the same list. Clip audio
  // deliberately does NOT count as voice here — it's the video model's own
  // baked-in soundtrack, not narration/dialogue, so ducking music under it
  // would be ducking under ambience.
  const voiceLayerPath = voicePath ? await padVoiceToMatch(voicePath, workDir, index, finalDuration) : null;
  if (voiceLayerPath) layers.push(voiceLayerPath);
  if (clipPath && includeClipAudio) {
    const clipAudioPath = await extractClipAudioLayer(clipPath, workDir, `scene${index}-clipaudio`, finalDuration);
    if (clipAudioPath) layers.push(clipAudioPath);
  }
  if (scene.music[0]) {
    const musicLayer = await buildAmbienceLayer(
      scene.music[0],
      workDir,
      `scene${index}-music`,
      finalDuration,
      scene.musicVolume,
      true,
      scene.musicFadeInSeconds,
      scene.musicFadeOutSeconds
    );
    // Ducking needs something to duck under — a scene with music but no
    // narration/dialogue keeps its flat level regardless of the flag, rather
    // than being handed a silent sidechain (which sidechaincompress would
    // read as "never over threshold" and pass through unchanged anyway, at
    // the cost of a pointless ffmpeg pass).
    layers.push(
      scene.duckMusicUnderDialogue && voiceLayerPath
        ? await duckMusicUnderVoice(musicLayer, voiceLayerPath, workDir, `scene${index}-music`, finalDuration)
        : musicLayer
    );
  }
  if (scene.sfx[0]) {
    layers.push(await buildAmbienceLayer(scene.sfx[0], workDir, `scene${index}-sfx`, finalDuration, scene.sfxVolume, false));
  }

  const audioPath = await mixAudioLayers(layers, workDir, index, finalDuration);
  const segmentPath = await muxSceneSegment(visualPath, audioPath, workDir, index, finalDuration);
  return {
    path: segmentPath,
    durationSeconds: finalDuration,
    hasVoice: voiceLayerPath != null,
    hasMusic: scene.music.length > 0,
    hasSfx: scene.sfx.length > 0,
  };
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
// the real reason the two stay separate functions: generateSilentAssembly
// keeps plain hard cuts so its per-scene manifest's startSeconds/
// durationSeconds (assumed non-overlapping) stay exactly correct — crossfade
// transitions are reserved for the real Final Assembly render alone.
//
// Returns each segment's actual start time in the finished render. Those are
// NOT a running sum of the segment durations — every transition overlaps its
// two neighbours, so each scene after the first starts `d` seconds earlier
// than a naive sum would say, and the drift compounds across a long episode.
// The numbers are already computed here (they're xfade's own `offset`), so
// handing them back is exact by construction; recomputing them in
// assembleVideo would mean duplicating the clamping rule below and silently
// desyncing the Sound Engineer's per-scene timeline the day it changes.
async function crossfadeConcatSegments(segmentPaths: string[], workDir: string, outPath: string): Promise<number[]> {
  if (segmentPaths.length === 1) {
    await fs.copyFile(segmentPaths[0], outPath);
    return [0];
  }

  const durations = await Promise.all(segmentPaths.map((p) => probeDuration(p)));

  const filterParts: string[] = [];
  const startSeconds: number[] = [0];
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
    startSeconds.push(offset);
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

  // Applied once to the fully-crossfaded output rather than per-input —
  // same COLOR_NORMALIZE_FILTER as resolveSceneClipPath's within-scene cuts,
  // reacting per-frame (smoothing=0) so it still corrects each scene's own
  // clip on its own terms even inside a blended transition frame, without
  // needing a separate normalize stage per input in this filter graph.
  filterParts.push(`[${videoLabel}]${COLOR_NORMALIZE_FILTER}[normv]`);
  videoLabel = "normv";

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
  return startSeconds;
}

// Shared by assembleVideo and generateSilentAssembly below — every scene
// needs a selected visual (image per shot, or a clip) before either can
// build anything; reports every unready scene at once rather than stopping
// at the first.
async function loadReadyScenes(parentType: ScenesParentType, parentId: string, language: string | null): Promise<AssemblyScene[]> {
  const scenes = await prisma.scene.findMany({
    where: parentWhere(parentType, parentId),
    orderBy: { order: "asc" },
    include: assemblySceneInclude(language),
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
  // Scene.closingState (see schema.prisma / scene-continuity.ts) — raw and
  // unparsed here since this manifest is also serialized to Asset.metadata
  // and read back later; audio-cue-plan.ts parses it defensively at the
  // point of use, same posture as everywhere else this crosses the
  // AI-response boundary. Lets the Audio Cue Plan pass ground ambience/music
  // continuity in the same environment/story-state Shot Planning resolved,
  // instead of inferring it fresh from the video alone.
  closingState: unknown;
  // Sound Engineer (AUDIO_MIXING_PLANNING) — the mix this scene was actually
  // rendered with, and which layers it actually contains. Only written by
  // assembleVideo (the real, audio-mixed render); absent on a SILENT_VIDEO
  // manifest, which by definition has no mix to describe. Optional rather
  // than nullable so a manifest serialized before this existed still parses
  // as a valid SceneManifestEntry when read back out of Asset.metadata —
  // same defensive posture as closingState above.
  mix?: SceneMixState;
}

export interface SceneMixState {
  musicVolume: number;
  sfxVolume: number;
  duckMusicUnderDialogue: boolean;
  musicFadeInSeconds: number | null;
  musicFadeOutSeconds: number | null;
  hasVoice: boolean;
  hasMusic: boolean;
  hasSfx: boolean;
}

export interface SerializedSilentVideo {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeSilentVideo(asset: Asset): SerializedSilentVideo {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

interface GenerateSilentAssemblyParams {
  parentType: ScenesParentType;
  parentId: string;
  modelId: string;
}

// Every scene's selected visual, stitched together with no narration/
// dialogue/music/sfx — a persisted, user-reviewable "picture only" take
// (Assemble without Audio), same take-history/isSelected pattern as
// assembleVideo below. Reuses buildVisualSegment directly at FULL_RES — the
// same native/explicit-duration segment buildSceneSegment builds as its
// first step for the real final assembly — so the timeline a cue plan is
// later drafted against (lib/audio-cue-plan.ts reads the selected take's
// video + manifest via getSelectedSilentPicture below) is exactly the
// timeline the real assembly will produce, not a separate approximation of
// it. The per-scene manifest is stored on the created Asset's own metadata
// field rather than recomputed later, so a cue-plan draft is grounded in
// scene state as of this generation — re-run this step if scenes/shots
// change afterward, same "re-run if you've edited things" expectation as
// Final Assembly itself.
export async function generateSilentAssembly({
  parentType,
  parentId,
  modelId,
}: GenerateSilentAssemblyParams): Promise<SerializedSilentVideo> {
  const projectId = await resolveParentProjectId(parentType, parentId);
  const startedAt = Date.now();
  // Picture-only — narrationAudio/dialogueLines[].audio aren't consumed
  // below (only scene.narration's text is, for the cue-plan manifest), so
  // which language's take gets queried is irrelevant. null keeps this one
  // query shape shared with assembleVideo's default (primary-language) call.
  const scenes = await loadReadyScenes(parentType, parentId, null);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-silent-"));
  try {
    const manifest: SceneManifestEntry[] = [];
    const segmentPaths: string[] = [];
    let cursor = 0;
    for (const [index, scene] of scenes.entries()) {
      // No voice track exists yet at this picture-only stage — always the
      // scene's own natural shot durations, never scaled.
      const { path: visualPath } = await buildVisualSegment(scene, workDir, index, FULL_RES, null);
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
        closingState: scene.closingState,
      });
      cursor += durationSeconds;
    }

    const finalPath = path.join(workDir, "silent.mp4");
    await concatSegments(segmentPaths, workDir, finalPath);
    const buffer = await fs.readFile(finalPath);
    const key = buildStorageKey(parentType === "story" ? "stories" : "episodes", parentId, "silent.mp4");
    await storage.put(key, buffer);

    const parentField = parentType === "story" ? { storySilentVideoId: parentId } : { episodeSilentVideoId: parentId };
    const asset = await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { ...parentSilentVideoWhere(parentType, parentId), isSelected: true },
        data: { isSelected: false },
      });
      return tx.asset.create({
        data: {
          type: "SILENT_VIDEO",
          storageKey: key,
          fileName: "silent.mp4",
          mimeType: "video/mp4",
          sizeBytes: buffer.byteLength,
          metadata: manifest as unknown as Prisma.InputJsonValue,
          ...parentField,
          isSelected: true,
          modelId,
          createdBy: "AI",
        },
      });
    });

    await recordGenerationEvent({
      jobType: "VIDEO",
      provider: "ffmpeg-silent-assembly",
      projectId,
      entityId: parentId,
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return serializeSilentVideo(asset);
  } catch (error) {
    await recordGenerationEvent({
      jobType: "VIDEO",
      provider: "ffmpeg-silent-assembly",
      projectId,
      entityId: parentId,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function getSilentVideos(parentType: ScenesParentType, parentId: string): Promise<SerializedSilentVideo[]> {
  const assets = await prisma.asset.findMany({
    where: parentSilentVideoWhere(parentType, parentId),
    orderBy: { createdAt: "desc" },
  });
  return assets.map(serializeSilentVideo);
}

export async function selectSilentVideo(
  parentType: ScenesParentType,
  parentId: string,
  assetId: string
): Promise<SerializedSilentVideo> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (!belongsToSilentParent(asset, parentType, parentId)) {
      throw new Error(`Silent assembly does not belong to this ${parentType}.`);
    }
    await tx.asset.updateMany({
      where: { ...parentSilentVideoWhere(parentType, parentId), isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { isSelected: true, reviewedAt: new Date() },
    });
    return serializeSilentVideo(updated);
  });
}

export async function deleteSilentVideo(parentType: ScenesParentType, parentId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (!belongsToSilentParent(asset, parentType, parentId)) {
    throw new Error(`Silent assembly does not belong to this ${parentType}.`);
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// Mirrors mapFinalVideos below — for the story/episode pages' initial SSR load.
export function mapSilentVideos<T extends { silentVideos: Asset[] }>(parent: T) {
  return { ...parent, silentVideos: parent.silentVideos.map(serializeSilentVideo) };
}

const CUE_PLAN_ATTACHMENT_WIDTH = 640;
const CUE_PLAN_ATTACHMENT_FPS = 8;
// Audio settings for the one attachment that keeps its soundtrack (the Sound
// Engineer's final-mix review — see getSelectedFinalMix). Mono at a low
// bitrate: the model is judging *level relationships* between voice, music
// and sfx, which a downmix preserves exactly, not stereo imaging or fidelity.
// Kept at the full sample rate anyway because the saving from halving it is
// negligible next to the video track, and resampling artefacts are the last
// thing a mix critique needs.
const MIX_ATTACHMENT_AUDIO_BITRATE = "64k";

// getSelectedSilentPicture used to base64 the selected take's raw bytes
// as-is — a full FULL_RES (1920x1080/30fps) render of the whole story/
// episode. Inlined as a video_url data URI in one JSON POST to OpenRouter
// (see draftAudioCuePlan), that consistently 502'd at OpenRouter's
// Cloudflare gateway: base64 already inflates size ~33%, and a multi-minute
// 1080p file pushes the request into tens of MB with no chunking, which the
// gateway apparently can't reliably buffer/forward. The cue-plan model only
// needs to recognize what's happening on screen per scene, not read fine
// detail, so this transcodes a much smaller copy — same total duration (so
// it still lines up with the manifest's per-scene timing), just far fewer
// pixels and frames — and sends that instead of the original.
//
// `keepAudio` is the one axis the two callers differ on. The cue plan watches
// a silent picture, so it drops audio outright (`-an`) — nothing to keep. The
// Sound Engineer reviews the finished mix, where the soundtrack IS the
// subject: stripping it would leave it critiquing levels it can't hear. The
// video treatment is identical either way, since both passes only need to
// recognize what's on screen per scene.
async function shrinkForModelAttachment(bytes: Buffer, keepAudio: boolean): Promise<Buffer> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-attachment-shrink-"));
  try {
    const inPath = path.join(workDir, "in.mp4");
    const outPath = path.join(workDir, "out.mp4");
    await fs.writeFile(inPath, bytes);
    await runFfmpeg([
      "-i", inPath,
      "-vf", `scale=${CUE_PLAN_ATTACHMENT_WIDTH}:-2,fps=${CUE_PLAN_ATTACHMENT_FPS}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "30",
      ...(keepAudio ? ["-c:a", "aac", "-b:a", MIX_ATTACHMENT_AUDIO_BITRATE, "-ac", "1"] : ["-an"]),
      outPath,
    ]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

// Reads the selected SILENT_VIDEO take for lib/audio-cue-plan.ts to draft
// against, instead of rebuilding the picture from scratch on every draft
// click. null means nothing has been assembled/selected yet — the caller
// surfaces a clear "assemble one first" error, same idiom as generation
// steps elsewhere that require a prior selected input.
export async function getSelectedSilentPicture(
  parentType: ScenesParentType,
  parentId: string
): Promise<{ base64: string; mimeType: string; manifest: SceneManifestEntry[] } | null> {
  const asset = await prisma.asset.findFirst({
    where: { ...parentSilentVideoWhere(parentType, parentId), isSelected: true },
  });
  if (!asset) return null;
  const bytes = await storage.get(asset.storageKey);
  if (!bytes) return null;
  const shrunk = await shrinkForModelAttachment(bytes, false);
  return {
    base64: shrunk.toString("base64"),
    mimeType: "video/mp4",
    manifest: (asset.metadata as unknown as SceneManifestEntry[] | null) ?? [],
  };
}

// The Sound Engineer's counterpart to getSelectedSilentPicture above, and
// deliberately not the same thing: this reads the selected FINAL_VIDEO —
// the render that already has narration, dialogue, music and sfx mixed into
// it — with its audio track intact, because critiquing a mix requires
// hearing it. See lib/audio-mixing-plan.ts.
//
// Scoped to `language: null` (the project's own primary-language render) to
// match what VideoAssemblyPanel itself shows and manages. Dub renders share
// this scene's music/sfx assets and mix fields verbatim (see
// assemblySceneInclude), so a mix plan drafted against the primary render
// applies to every dub too — drafting per-language would propose the same
// numbers at N times the cost.
//
// null means nothing has been assembled/selected yet; an empty manifest
// means the selected take predates assembleVideo recording one, which the
// caller reports as "re-run Final Assembly" rather than guessing at a
// timeline.
export async function getSelectedFinalMix(
  parentType: ScenesParentType,
  parentId: string
): Promise<{ base64: string; mimeType: string; manifest: SceneManifestEntry[] } | null> {
  const asset = await prisma.asset.findFirst({
    where: { ...parentVideoWhere(parentType, parentId), language: null, isSelected: true },
  });
  if (!asset) return null;
  const bytes = await storage.get(asset.storageKey);
  if (!bytes) return null;
  const shrunk = await shrinkForModelAttachment(bytes, true);
  return {
    base64: shrunk.toString("base64"),
    mimeType: "video/mp4",
    manifest: (asset.metadata as unknown as SceneManifestEntry[] | null) ?? [],
  };
}

interface AssembleVideoParams {
  parentType: ScenesParentType;
  parentId: string;
  modelId: string;
  // Off by default — matches the pre-existing behavior of always discarding
  // a video clip's own audio track (e.g. Veo3 Lite's generated sound) in
  // favor of just narration/dialogue/music/sfx.
  includeClipAudio?: boolean;
  // Dubbing — omitted/undefined renders the project's own primary language
  // exactly as before. Set, re-runs this same pipeline pulling that dub
  // language's selected narration/dialogue takes instead (via
  // assemblySceneInclude) — visuals, music, and sfx are identical either
  // way (see assemblySceneInclude's comment for why those aren't
  // per-language), only the voice track and therefore each scene's
  // ILLUSTRATION pacing (buildIllustrationSegment's scaleToSeconds) differ.
  // See lib/localization.ts.
  language?: string;
}

export async function assembleVideo({
  parentType,
  parentId,
  modelId,
  includeClipAudio = false,
  language,
}: AssembleVideoParams): Promise<SerializedFinalVideo> {
  const projectId = await resolveParentProjectId(parentType, parentId);
  const startedAt = Date.now();
  const scenes = await loadReadyScenes(parentType, parentId, language ?? null);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrata-assembly-"));
  try {
    const segments: SceneSegmentResult[] = [];
    for (const [index, scene] of scenes.entries()) {
      segments.push(await buildSceneSegment(scene, workDir, index, includeClipAudio));
    }

    const finalPath = path.join(workDir, "final.mp4");
    const startSeconds = await crossfadeConcatSegments(
      segments.map((s) => s.path),
      workDir,
      finalPath
    );

    // Same per-scene manifest generateSilentAssembly records on its own take,
    // with this render's mix state added — see SceneManifestEntry. Stored on
    // the Asset rather than recomputed later so the Sound Engineer pass
    // (lib/audio-mixing-plan.ts) is grounded in the scene state that produced
    // the exact render it's listening to, not in whatever the scenes have
    // been edited into since. Start times come from the crossfade step's own
    // offsets, so they account for transition overlap.
    const manifest: SceneManifestEntry[] = scenes.map((scene, index) => ({
      sceneId: scene.id,
      order: scene.order,
      title: scene.title,
      startSeconds: startSeconds[index] ?? 0,
      durationSeconds: segments[index].durationSeconds,
      characterNames: scene.characters.map((c) => c.name),
      narration: scene.narration,
      dialogueLines: scene.dialogueLines.map((l) => ({ character: l.character.name, text: l.text })),
      musicPrompt: scene.musicPrompt,
      sfxPrompt: scene.sfxPrompt,
      closingState: scene.closingState,
      mix: {
        musicVolume: scene.musicVolume,
        sfxVolume: scene.sfxVolume,
        duckMusicUnderDialogue: scene.duckMusicUnderDialogue,
        musicFadeInSeconds: scene.musicFadeInSeconds,
        musicFadeOutSeconds: scene.musicFadeOutSeconds,
        hasVoice: segments[index].hasVoice,
        hasMusic: segments[index].hasMusic,
        hasSfx: segments[index].hasSfx,
      },
    }));

    const buffer = await fs.readFile(finalPath);
    const fileName = language ? `final-${language}.mp4` : "final.mp4";
    const key = buildStorageKey(parentType === "story" ? "stories" : "episodes", parentId, fileName);
    await storage.put(key, buffer);

    const parentField = parentType === "story" ? { storyVideoId: parentId } : { episodeVideoId: parentId };
    const asset = await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { ...parentVideoWhere(parentType, parentId), language: language ?? null, isSelected: true },
        data: { isSelected: false },
      });
      return tx.asset.create({
        data: {
          type: "FINAL_VIDEO",
          storageKey: key,
          fileName,
          mimeType: "video/mp4",
          sizeBytes: buffer.byteLength,
          metadata: manifest as unknown as Prisma.InputJsonValue,
          ...parentField,
          language: language ?? null,
          isSelected: true,
          modelId,
          createdBy: "AI",
        },
      });
    });

    await recordGenerationEvent({
      jobType: "VIDEO",
      provider: "ffmpeg-final-assembly",
      projectId,
      entityId: parentId,
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return serializeFinalVideo(asset);
  } catch (error) {
    await recordGenerationEvent({
      jobType: "VIDEO",
      provider: "ffmpeg-final-assembly",
      projectId,
      entityId: parentId,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
    // Scoped to this asset's own language — a dub render's take history is
    // independent of the primary language's, and of every other dub
    // language's. See selectNarrationAudio's identical reasoning in voice.ts.
    await tx.asset.updateMany({
      where: { ...parentVideoWhere(parentType, parentId), language: asset.language, isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { isSelected: true, reviewedAt: new Date() },
    });
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
