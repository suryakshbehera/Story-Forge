import { prisma, type Asset } from "@/lib/db";
import { generateImage, OpenRouterError } from "@/lib/ai/openrouter";
import { decodeMonoPcm16, diffImagesGray, probeImageSize } from "@/lib/ffmpeg";
import { recordGenerationEvent, resolveSceneProjectId } from "@/lib/generation-events";
import { storage } from "@/lib/storage";

// "Mouth flap" for 2D ILLUSTRATION scenes — a deliberately simple stand-in for
// real lipsync. A speaking shot gets an "open-mouth" twin of its selected
// image (an image-to-image edit, see generateMouthOpenFrames), and the final
// render swaps between the two by the loudness of that shot's voice take (see
// analyzeMouthIntervals and buildIllustrationSegment in video-assembly.ts).
//
// The twin deliberately has no Asset row: it is derived from one specific
// selected image, so its storage key embeds that image's asset id. Selecting
// or regenerating the shot's image changes the id, the old twin simply stops
// being found, and the render falls back to the plain still — never to a
// twin that no longer matches the picture. Keeps this feature migration-free.
//
// Shot <-> voice mapping: Shot has no link to DialogueLine (see the note on
// Shot.emotion in schema.prisma), so this only activates when a scene has
// exactly one shot per voice item, in voice order — narration first (when the
// scene has narration text), then each dialogue line. Anything else is left
// on the existing proportional-timing render, unchanged.

export function mouthOpenKey(shotId: string, baseImageAssetId: string): string {
  return `shots/${shotId}/mouth-open-${baseImageAssetId}.png`;
}

export type VoiceItem = { kind: "narration" } | { kind: "dialogue"; speaker: string };

interface SceneForMapping {
  narration: string | null;
  shots: { id: string }[];
  dialogueLines: { character: { name: string } }[];
}

// The ordered voice items a scene will play (matches the order
// buildSceneVoiceTrack concatenates them in), or null when the scene's shots
// don't line up one-to-one with them.
export function mapVoiceItemsToShots(scene: SceneForMapping): VoiceItem[] | null {
  const items: VoiceItem[] = [];
  if (scene.narration?.trim()) items.push({ kind: "narration" });
  for (const line of scene.dialogueLines) items.push({ kind: "dialogue", speaker: line.character.name });
  if (items.length === 0 || items.length !== scene.shots.length) return null;
  return items;
}

const MOUTH_OPEN_PROMPT =
  "This is a frame from a flat 2D cartoon. Recreate this exact image — the same character, pose, framing, camera distance, background, colours, outline style and lighting — with exactly ONE change: the character's mouth is now wide open in the middle of speaking a loud, expressive sentence (jaw dropped, visible teeth and tongue, cartoon style). Keep the eyes, eyebrows, head position and everything else identical. Do not add or remove any object, character or text.";

export interface MouthFrameStatus {
  /** The scene's shots line up with its voice items, so twins can be made. */
  eligible: boolean;
  reason: string | null;
  talkingShots: number;
  /** Speaking shots that already have an open-mouth twin. */
  ready: number;
  /**
   * Set when the twins exist but the render would still skip the flap — the
   * scene is missing a voice take or a selected image. Generating twins needs
   * neither, so this is a separate warning rather than a reason to block the
   * button: without it the panel reported "3 of 3 ready" while the render
   * quietly produced no mouth movement at all.
   */
  renderBlockedReason: string | null;
}

// Everything planMouthFlap (video-assembly.ts) additionally requires before
// it will flap a scene, as one check both it and the status endpoint call —
// they drifted apart before, which is exactly how the panel came to claim a
// scene was ready that the render then skipped.
export interface FlapPreconditionScene {
  narrationAudio: { id: string }[];
  shots: { images: { id: string }[] }[];
  dialogueLines: { audio: { id: string }[] }[];
}

export function flapRenderBlockedReason(scene: FlapPreconditionScene, items: VoiceItem[]): string | null {
  // buildSceneVoiceTrack plays narrationAudio[0] whenever it exists and skips
  // any line without audio — the shot mapping only holds if that agrees with
  // the items the shots were planned against.
  const narrationExpected = items[0].kind === "narration";
  if (narrationExpected && !scene.narrationAudio[0]) {
    return "the narration has no selected voice take, so the shots no longer line up with what gets played.";
  }
  if (!narrationExpected && scene.narrationAudio[0]) {
    return "there's a selected narration take but no narration text, so the shots no longer line up with what gets played.";
  }
  if (scene.dialogueLines.some((line) => !line.audio[0])) {
    return "every dialogue line needs a selected voice take.";
  }
  if (scene.shots.some((shot) => !shot.images[0])) {
    return "every shot needs a selected image.";
  }
  return null;
}

// `language: null` is the project's own primary language — the takes the
// default render plays (see assemblySceneInclude in video-assembly.ts). A dub
// render re-checks its own language's takes at render time, so a scene that
// is ready here can still skip the flap in a dub that isn't fully voiced.
async function loadSceneForMouthFrames(sceneId: string) {
  return prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      shots: { orderBy: { order: "asc" }, include: { images: { where: { isSelected: true }, take: 1 } } },
      dialogueLines: {
        orderBy: { order: "asc" },
        include: {
          character: { select: { name: true } },
          audio: { where: { isSelected: true, language: null }, take: 1 },
        },
      },
      narrationAudio: { where: { isSelected: true, language: null }, take: 1 },
    },
  });
}

export async function getMouthFrameStatus(sceneId: string): Promise<MouthFrameStatus> {
  const scene = await loadSceneForMouthFrames(sceneId);
  const items = mapVoiceItemsToShots(scene);
  if (!items) {
    return {
      eligible: false,
      reason: "Needs exactly one shot per voice item (narration first, then each dialogue line).",
      talkingShots: 0,
      ready: 0,
      renderBlockedReason: null,
    };
  }
  let talking = 0;
  let ready = 0;
  for (const [i, item] of items.entries()) {
    if (item.kind !== "dialogue") continue;
    talking++;
    const image = scene.shots[i].images[0];
    if (image && (await storage.stat(mouthOpenKey(scene.shots[i].id, image.id)))) ready++;
  }
  return {
    eligible: true,
    reason: null,
    talkingShots: talking,
    ready,
    renderBlockedReason: ready > 0 ? flapRenderBlockedReason(scene, items) : null,
  };
}

export interface MouthFrameResult {
  generated: number;
  skipped: number;
  failed: { shotId: string; error: string }[];
}

// Generates the open-mouth twin for every speaking shot in the scene that has
// a selected image and doesn't already have a current twin. One image call
// each (costUsd is recorded per call, same as any other IMAGE_GENERATION).
export async function generateMouthOpenFrames({
  sceneId,
  imageModelId,
  force = false,
}: {
  sceneId: string;
  imageModelId: string;
  force?: boolean;
}): Promise<MouthFrameResult> {
  const scene = await loadSceneForMouthFrames(sceneId);
  const items = mapVoiceItemsToShots(scene);
  if (!items) {
    throw new OpenRouterError(
      "This scene needs exactly one shot per voice item (narration first, then each dialogue line) before talking frames can be made."
    );
  }
  const projectId = await resolveSceneProjectId(sceneId);

  const result: MouthFrameResult = { generated: 0, skipped: 0, failed: [] };
  for (const [i, item] of items.entries()) {
    if (item.kind !== "dialogue") continue;
    const shot = scene.shots[i];
    const image: Asset | undefined = shot.images[0];
    if (!image) {
      result.skipped++;
      continue;
    }
    const key = mouthOpenKey(shot.id, image.id);
    if (!force && (await storage.stat(key))) {
      result.skipped++;
      continue;
    }

    const base = await storage.get(image.storageKey);
    if (!base) {
      result.failed.push({ shotId: shot.id, error: "The shot's selected image is missing from storage." });
      continue;
    }
    const dataUri = `data:${image.mimeType ?? "image/png"};base64,${base.toString("base64")}`;

    const startedAt = Date.now();
    try {
      const generated = await generateImage({ modelId: imageModelId, prompt: MOUTH_OPEN_PROMPT, inputReferences: [dataUri] });
      await recordGenerationEvent({
        jobType: "IMAGE_GENERATION",
        provider: "openrouter",
        modelId: imageModelId,
        projectId,
        entityType: "SHOT",
        entityId: shot.id,
        costUsd: generated.costUsd,
        durationMs: Date.now() - startedAt,
        success: true,
      });
      await storage.put(key, Buffer.from(generated.base64, "base64"));
      result.generated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordGenerationEvent({
        jobType: "IMAGE_GENERATION",
        provider: "openrouter",
        modelId: imageModelId,
        projectId,
        entityType: "SHOT",
        entityId: shot.id,
        durationMs: Date.now() - startedAt,
        success: false,
        errorMessage: message,
      });
      result.failed.push({ shotId: shot.id, error: message });
    }
  }
  return result;
}

// ── Loudness envelope → mouth-open intervals ───────────────────────────────

const ANALYSIS_SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = 320; // 20ms
const WINDOW_SECONDS = WINDOW_SAMPLES / ANALYSIS_SAMPLE_RATE;
// The mouth opens on each *syllable nucleus* — a window louder than the local
// average around it — rather than on "louder than a fixed share of the take".
// Plain level thresholding only drops back below the line at real pauses, so
// a whole phrase came out as one 400ms+ hold: the mouth hung open instead of
// articulating. Comparing each window against a rolling local average makes
// every vowel peak its own opening, which is what reads as talking.
const LOCAL_AVERAGE_RADIUS_WINDOWS = 4; // ±80ms
// Speech gate, so quiet room tone between lines can't produce nuclei of its
// own: a window must also clear this share of the take's 90th-percentile
// loudness (and OPEN_ABSOLUTE_FLOOR) before it counts as speech at all.
const OPEN_GATE_FRACTION = 0.18;
const OPEN_ABSOLUTE_FLOOR = 120; // out of 32768 — never treat near-silence as speech
// Both states are floored at ~2 frames at 30fps. Anything shorter can't
// render as a distinct state and just reads as a one-frame glitch, so a
// shorter closure is absorbed (MAX_MERGE_GAP_WINDOWS) and a shorter opening
// is dropped (MIN_OPEN_WINDOWS).
const MIN_OPEN_WINDOWS = 3; // 60ms
const MAX_MERGE_GAP_WINDOWS = 2; // closures under 60ms are absorbed

export interface MouthInterval {
  start: number;
  end: number;
}

// When (in seconds from the start of the take) the mouth should be open.
// Scale-free by construction: the nucleus test is relative to the take's own
// local loudness, so a whisper and a shout both articulate.
export async function analyzeMouthIntervals(audioPath: string): Promise<MouthInterval[]> {
  const pcm = await decodeMonoPcm16(audioPath, ANALYSIS_SAMPLE_RATE);
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const windowCount = Math.floor(sampleCount / WINDOW_SAMPLES);
  if (windowCount === 0) return [];

  const envelope: number[] = [];
  for (let w = 0; w < windowCount; w++) {
    let sumSquares = 0;
    for (let s = 0; s < WINDOW_SAMPLES; s++) {
      const v = pcm.readInt16LE((w * WINDOW_SAMPLES + s) * 2);
      sumSquares += v * v;
    }
    envelope.push(Math.sqrt(sumSquares / WINDOW_SAMPLES));
  }

  const sorted = [...envelope].sort((a, b) => a - b);
  const p90 = sorted[Math.min(Math.floor(sorted.length * 0.9), sorted.length - 1)];
  const gate = Math.max(p90 * OPEN_GATE_FRACTION, OPEN_ABSOLUTE_FLOOR);

  const open = envelope.map((level, i) => {
    if (level <= gate) return false;
    const from = Math.max(0, i - LOCAL_AVERAGE_RADIUS_WINDOWS);
    const to = Math.min(envelope.length - 1, i + LOCAL_AVERAGE_RADIUS_WINDOWS);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += envelope[j];
    return level > sum / (to - from + 1);
  });

  const runs: { start: number; end: number }[] = []; // in windows, end exclusive
  for (let w = 0; w < open.length; w++) {
    if (!open[w]) continue;
    const last = runs[runs.length - 1];
    if (last && w - last.end <= MAX_MERGE_GAP_WINDOWS) last.end = w + 1;
    else runs.push({ start: w, end: w + 1 });
  }

  return runs
    .filter((r) => r.end - r.start >= MIN_OPEN_WINDOWS)
    .map((r) => ({ start: r.start * WINDOW_SECONDS, end: r.end * WINDOW_SECONDS }));
}

// ffmpeg overlay `enable` expression: non-zero (true) while the mouth is open.
// `scale` stretches the take-relative times when the caller has scaled the
// shot's length to fit the scene's voice track.
export function mouthOpenEnableExpression(intervals: MouthInterval[], scale = 1): string {
  return intervals.map((i) => `between(t,${(i.start * scale).toFixed(3)},${(i.end * scale).toFixed(3)})`).join("+");
}

// ── Where on the picture the mouth actually is ─────────────────────────────

// The open-mouth twin is a whole-frame regeneration, so it differs from the
// still *everywhere* by a pixel or two — the image model redraws every line,
// not just the mouth. Swapping the entire frame therefore made the whole
// background twitch in time with the mouth. Instead the render composites
// back only the region that actually changed, so every pixel outside it is
// identical between the two states and simply cannot move.
export interface MouthBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BOX_ANALYSIS_WIDTH = 384;
const BOX_BLUR_SIGMA = 2;
const BOX_DIFF_THRESHOLD = 40; // per-pixel gray difference that counts as "changed"
// Grown around the detected blob so the swap carries the moustache, chin and
// cheek movement that trails the mouth, not only the lips themselves.
const BOX_PADDING = 0.35;
// A blob this large isn't a mouth — the model reframed or redrew the whole
// picture, and there is no safe region to swap. The caller falls back.
const MAX_BOX_AREA_FRACTION = 0.25;
const MIN_BOX_SIDE = 8;

// Bounding box, in `basePath`'s pixel coordinates, of the largest cluster of
// change between the still and its open-mouth twin — in practice the mouth.
// null when the images can't be compared or the change isn't localized.
export async function detectMouthBox(basePath: string, twinPath: string): Promise<MouthBox | null> {
  const { width: fullWidth, height: fullHeight } = await probeImageSize(basePath);
  const analysisWidth = Math.min(BOX_ANALYSIS_WIDTH, fullWidth);
  const analysisHeight = Math.max(1, Math.round((analysisWidth * fullHeight) / fullWidth));
  const diff = await diffImagesGray(basePath, twinPath, analysisWidth, analysisHeight, BOX_BLUR_SIGMA);
  if (diff.byteLength < analysisWidth * analysisHeight) return null;

  // Flood-fill every above-threshold cluster and keep the one carrying the
  // most total change — the mouth, even when a shoulder or a hand also
  // shifted slightly.
  const seen = new Uint8Array(analysisWidth * analysisHeight);
  let best: { x0: number; y0: number; x1: number; y1: number; mass: number } | null = null;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] === 1 || diff[start] <= BOX_DIFF_THRESHOLD) continue;
    const stack: number[] = [start];
    seen[start] = 1;
    let x0 = analysisWidth;
    let y0 = analysisHeight;
    let x1 = 0;
    let y1 = 0;
    let mass = 0;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % analysisWidth;
      const y = (p - x) / analysisWidth;
      mass += diff[p];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= analysisWidth || ny >= analysisHeight) continue;
          const q = ny * analysisWidth + nx;
          if (seen[q] === 1 || diff[q] <= BOX_DIFF_THRESHOLD) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!best || mass > best.mass) best = { x0, y0, x1, y1, mass };
  }
  if (!best) return null;

  const toFull = fullWidth / analysisWidth;
  const centerX = ((best.x0 + best.x1 + 1) / 2) * toFull;
  const centerY = ((best.y0 + best.y1 + 1) / 2) * toFull;
  const paddedWidth = (best.x1 - best.x0 + 1) * toFull * (1 + 2 * BOX_PADDING);
  const paddedHeight = (best.y1 - best.y0 + 1) * toFull * (1 + 2 * BOX_PADDING);

  const x = Math.max(0, Math.round(centerX - paddedWidth / 2));
  const y = Math.max(0, Math.round(centerY - paddedHeight / 2));
  const width = Math.min(fullWidth - x, Math.round(paddedWidth));
  const height = Math.min(fullHeight - y, Math.round(paddedHeight));
  if (width < MIN_BOX_SIDE || height < MIN_BOX_SIDE) return null;
  if ((width * height) / (fullWidth * fullHeight) > MAX_BOX_AREA_FRACTION) return null;
  return { x, y, width, height };
}

// Feathered edge, as a share of the box's shorter side. A hard rectangle
// edge would pop on every swap wherever the twin's redrawn lines sit a pixel
// off the still's; fading the box out hides that entirely.
const BOX_FEATHER = 0.18;

// filter_complex fragment compositing the twin's mouth region (input
// `[1:v]`) onto the still (input `[0:v]`) whenever `enableExpression` is
// true, leaving the result at the still's full size on `[<outLabel>]`. The
// composite happens in source pixel coordinates, *before* any camera move,
// so the box detectMouthBox found stays valid however the shot is framed.
export function mouthCompositeFilter(box: MouthBox, enableExpression: string, outLabel: string): string {
  const shortSide = Math.min(box.width, box.height);
  const feather = Math.max(1, Math.min(Math.floor(shortSide / 2) - 1, Math.round(shortSide * BOX_FEATHER)));
  const sigma = Math.max(1, feather / 2).toFixed(2);
  return (
    `[1:v]crop=${box.width}:${box.height}:${box.x}:${box.y}[mouthsrc];` +
    `color=black:s=${box.width}x${box.height},` +
    `drawbox=x=${feather}:y=${feather}:w=${box.width - 2 * feather}:h=${box.height - 2 * feather}:color=white:t=fill,` +
    `gblur=sigma=${sigma},format=gray[mouthmask];` +
    `[mouthsrc][mouthmask]alphamerge[mouthcut];` +
    `[0:v][mouthcut]overlay=${box.x}:${box.y}:enable='${enableExpression}'[${outLabel}]`
  );
}
