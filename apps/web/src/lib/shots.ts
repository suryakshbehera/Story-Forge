import { z } from "zod";
import { CAMERA_MOVEMENTS, type CameraMovementValue } from "@/lib/video-model-config";
import {
  prisma,
  Prisma,
  type CameraMovement,
  type ShotSize,
  type CameraAngle,
  type ShotFraming,
  type DepthOfField,
  type LightingStyle,
  type ShotComposition,
  type Emotion,
  type EmotionIntensity,
} from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { storage } from "@/lib/storage";
import {
  findLastShotOfPreviousScene,
  findPreviousSceneClosingState,
  parseContinuitySnapshot,
  parseClosingState,
  describeClosingState,
} from "@/lib/scene-continuity";
import { SHOT_SIZE_LABELS, CAMERA_ANGLE_LABELS } from "@/lib/cinematography";

const SHOT_INCLUDE = {
  images: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      storageKey: true,
      isSelected: true,
      validationPassed: true,
      validationNotes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ShotInclude;

export type ShotWithImages = Prisma.ShotGetPayload<{ include: typeof SHOT_INCLUDE }>;

// storageKey is a server-side detail — replace each image with a
// client-facing url before a shot ever gets sent in a response. Mirrors
// scenes.ts's mapSceneShots, one level down.
export function mapShotImages<T extends ShotWithImages>(shot: T) {
  return {
    ...shot,
    // A Date here would cross the server→client boundary as a real Date
    // instance for SSR-provided initial props (React Flight supports that)
    // but as a string for every fetch()-based update — normalize to string
    // always so ShotItem's shape is consistent regardless of source.
    imageGenerationStartedAt: shot.imageGenerationStartedAt?.toISOString() ?? null,
    images: shot.images.map((img) => ({
      id: img.id,
      url: storage.url(img.storageKey),
      isSelected: img.isSelected,
      validationPassed: img.validationPassed,
      validationNotes: img.validationNotes,
      createdAt: img.createdAt,
    })),
  };
}

export function mapShotsImages<T extends ShotWithImages>(shots: T[]) {
  return shots.map(mapShotImages);
}

export async function resequenceShots(tx: Prisma.TransactionClient, sceneId: string) {
  const remaining = await tx.shot.findMany({ where: { sceneId }, orderBy: { order: "asc" } });
  for (let i = 0; i < remaining.length; i++) {
    const expectedOrder = i + 1;
    if (remaining[i].order !== expectedOrder) {
      await tx.shot.update({ where: { id: remaining[i].id }, data: { order: expectedOrder } });
    }
  }
}

export { SHOT_INCLUDE };

// ── AI shot planning (SHOT_PLANNING) — mirrors SCENE_PLANNING one level
// down: Story→Scenes becomes Scene→Shots. Always scoped to one scene, same
// "never a whole-episode pass" rule the rest of the per-scene AI steps
// follow. ─────────────────────────────────────────────────────────────────

export class ShotsExistError extends Error {
  constructor(public existingCount: number) {
    super(`${existingCount} shot(s) already exist. Pass regenerateAll to replace them.`);
  }
}

// Imported, not redeclared — this list used to be duplicated here, which
// meant adding a movement silently left SHOT_PLANNING unable to draft it
// while the dropdown offered it. lib/video-model-config.ts is the one TS
// source (it has no imports, so it's safe from both client and server).
//
// These cues exist because the distinctions are exactly the ones models
// conflate — "push in" is written as a zoom at least as often as a dolly,
// and the two are not the same shot. Every value in CAMERA_MOVEMENTS must
// have one: the Record type makes a missing cue a compile error.
const CAMERA_MOVEMENT_CUES: Record<CameraMovementValue, string> = {
  STATIC: "the camera does not move at all",
  ZOOM_IN: "optical zoom in — the camera stays put and the field of view narrows; perspective and parallax do not change",
  ZOOM_OUT: "optical zoom out — the camera stays put and the field of view widens; perspective and parallax do not change",
  DOLLY_IN:
    "the camera physically moves toward the subject (a push-in) — perspective and parallax change as the background shifts relative to the subject; this is not a zoom",
  DOLLY_OUT:
    "the camera physically moves away from the subject (a pull-back) — perspective and parallax change; this is not a zoom",
  CRASH_ZOOM: "a fast, aggressive optical zoom snapped in over a beat — same optics as ZOOM_IN, but the speed is the point; use it for shock or emphasis",
  DOLLY_ZOOM:
    "the Vertigo effect — the camera dollies while the lens zooms the opposite way, so the subject stays the same size while the background stretches or compresses behind them. Never pick this as a way of saying 'dolly and also zoom'; it is one disorienting effect for a moment of realization or dread",
  PAN_LEFT: "the camera rotates left in place, pivoting without travelling",
  PAN_RIGHT: "the camera rotates right in place, pivoting without travelling",
  WHIP_PAN: "a very fast pan that smears the frame into motion blur — usually a transition or a snap of attention, not a way to survey a space",
  TILT_UP: "the camera rotates upward in place, pivoting without travelling — the camera's position does not change, only its angle",
  TILT_DOWN: "the camera rotates downward in place, pivoting without travelling — the camera's position does not change, only its angle",
  ROLL: "the camera rotates around the lens axis, so the horizon itself tilts — used for disorientation or unease; it is not a tilt (which pivots up/down) and not a dutch angle held static",
  TRACK_LEFT: "the camera travels laterally to the left, usually alongside a moving subject — it translates, it does not pivot",
  TRACK_RIGHT: "the camera travels laterally to the right, usually alongside a moving subject — it translates, it does not pivot",
  PEDESTAL_UP:
    "the camera body rises straight up while keeping its angle, like a lift — the framing translates upward. Not a TILT_UP (which only rotates) and not a CRANE_UP (which sweeps the viewpoint through an arc)",
  PEDESTAL_DOWN:
    "the camera body drops straight down while keeping its angle — the framing translates downward. Not a TILT_DOWN (rotation only) and not a CRANE_DOWN (an arc)",
  CRANE_UP: "the camera rises through space on an arm, the whole viewpoint sweeping up and usually back — a bigger, more sweeping move than a pedestal",
  CRANE_DOWN: "the camera descends through space on an arm, the viewpoint sweeping down into the scene — a bigger move than a pedestal",
  ARC_LEFT: "the camera circles the subject to the left, orbiting around them so the background rotates behind them while they stay centred",
  ARC_RIGHT: "the camera circles the subject to the right, orbiting around them so the background rotates behind them while they stay centred",
  STEADICAM_FOLLOW:
    "a smooth, stabilized follow that stays with a moving subject through space — fluid and gliding, the opposite of HANDHELD's unsteadiness despite both being body-mounted",
  HANDHELD:
    "naturalistic small-amplitude unsteadiness, as if hand-carried — a texture applied to the shot, not a direction of travel; pick it for immediacy or unease, never as a way of saying 'some movement'",
  AERIAL: "an airborne vantage — drone or helicopter — looking down over the scene from above and usually drifting. Describes where the camera is, so pick it for scale and geography",
};

const CAMERA_MOVEMENTS_PROMPT_LIST = CAMERA_MOVEMENTS.map((m) => `- ${m}: ${CAMERA_MOVEMENT_CUES[m]}`).join("\n");

// ── Director AI cinematography ───────────────────────────────────────────
// Closed vocabularies mirroring the Prisma enums (see schema.prisma's
// "Director AI cinematography vocabulary" block). Kept as local const arrays
// rather than imported enum objects for the same reason CAMERA_MOVEMENTS is:
// they're needed as a *list* to interpolate into the prompt and to validate
// against, which the generated type alone can't do.

const SHOT_SIZES = ["EXTREME_WIDE", "WIDE", "FULL", "MEDIUM", "MEDIUM_CLOSE_UP", "CLOSE_UP", "EXTREME_CLOSE_UP"] as const;
const CAMERA_ANGLES = ["EYE_LEVEL", "LOW", "HIGH", "OVERHEAD", "DUTCH", "OVER_THE_SHOULDER", "POV"] as const;
const SHOT_FRAMINGS = ["SINGLE", "TWO_SHOT", "THREE_SHOT", "GROUP", "INSERT", "ESTABLISHING"] as const;
const DEPTHS_OF_FIELD = ["SHALLOW", "MEDIUM", "DEEP"] as const;
const LIGHTING_STYLES = [
  "NATURAL",
  "SOFT",
  "HARD",
  "HIGH_KEY",
  "LOW_KEY",
  "BACKLIT",
  "SILHOUETTE",
  "GOLDEN_HOUR",
  "MOONLIT",
  "PRACTICAL",
] as const;
const SHOT_COMPOSITIONS = [
  "CENTERED",
  "RULE_OF_THIRDS",
  "SYMMETRICAL",
  "LEADING_LINES",
  "FRAME_WITHIN_FRAME",
  "NEGATIVE_SPACE",
  "DIAGONAL",
] as const;

// ── Director AI emotion vocabulary — same closed-list reasoning as the
// cinematography vocabulary above, one axis over (see schema.prisma's
// Emotion/EmotionIntensity enums).
const EMOTIONS = [
  "JOY",
  "LOVE",
  "HOPE",
  "PRIDE",
  "RELIEF",
  "SADNESS",
  "GRIEF",
  "LONELINESS",
  "DESPAIR",
  "NOSTALGIA",
  "ANGER",
  "RAGE",
  "FRUSTRATION",
  "RESENTMENT",
  "FEAR",
  "ANXIETY",
  "DREAD",
  "PANIC",
  "SURPRISE",
  "SHOCK",
  "AWE",
  "CONFUSION",
  "CURIOSITY",
  "SHAME",
  "GUILT",
  "JEALOUSY",
  "BETRAYAL",
  "DESIRE",
  "DETERMINATION",
  "COURAGE",
  "DEFIANCE",
  "TRIUMPH",
  "SUSPENSE",
  "CALM",
  "DOUBT",
  "EXHAUSTION",
] as const;
const EMOTION_INTENSITIES = ["SUBTLE", "MODERATE", "INTENSE"] as const;

const MIN_LENS_MM = 8;
const MAX_LENS_MM = 300;

// Models reach for film-grammar shorthand ("MCU", "bird's eye", "medium
// shot") no matter how the prompt enumerates the vocabulary — mapping the
// common aliases is far cheaper than discarding an otherwise-correct
// direction, and an unmapped value degrades to null (silent on that axis)
// rather than failing the whole scene's plan.
const SHOT_SIZE_SYNONYMS: Record<string, ShotSize> = {
  MEDIUM_SHOT: "MEDIUM",
  MS: "MEDIUM",
  MCU: "MEDIUM_CLOSE_UP",
  MEDIUM_CLOSEUP: "MEDIUM_CLOSE_UP",
  ECU: "EXTREME_CLOSE_UP",
  EXTREME_CLOSEUP: "EXTREME_CLOSE_UP",
  CU: "CLOSE_UP",
  CLOSEUP: "CLOSE_UP",
  WIDE_SHOT: "WIDE",
  WS: "WIDE",
  LONG_SHOT: "WIDE",
  EXTREME_WIDE_SHOT: "EXTREME_WIDE",
  EWS: "EXTREME_WIDE",
  FULL_SHOT: "FULL",
  FULL_BODY: "FULL",
};
const CAMERA_ANGLE_SYNONYMS: Record<string, CameraAngle> = {
  BIRDS_EYE: "OVERHEAD",
  BIRDS_EYE_VIEW: "OVERHEAD",
  TOP_DOWN: "OVERHEAD",
  OTS: "OVER_THE_SHOULDER",
  LOW_ANGLE: "LOW",
  WORMS_EYE: "LOW",
  HIGH_ANGLE: "HIGH",
  EYELEVEL: "EYE_LEVEL",
  NEUTRAL: "EYE_LEVEL",
  DUTCH_ANGLE: "DUTCH",
  CANTED: "DUTCH",
  POINT_OF_VIEW: "POV",
};
const SHOT_FRAMING_SYNONYMS: Record<string, ShotFraming> = {
  SINGLE_SHOT: "SINGLE",
  TWO: "TWO_SHOT",
  THREE: "THREE_SHOT",
  GROUP_SHOT: "GROUP",
  CROWD: "GROUP",
  INSERT_SHOT: "INSERT",
  ESTABLISHING_SHOT: "ESTABLISHING",
  MASTER: "ESTABLISHING",
};
const DEPTH_OF_FIELD_SYNONYMS: Record<string, DepthOfField> = {
  BOKEH: "SHALLOW",
  SHALLOW_FOCUS: "SHALLOW",
  DEEP_FOCUS: "DEEP",
  MEDIUM_DEPTH: "MEDIUM",
};
const LIGHTING_STYLE_SYNONYMS: Record<string, LightingStyle> = {
  DAYLIGHT: "NATURAL",
  AVAILABLE_LIGHT: "NATURAL",
  SOFT_LIGHT: "SOFT",
  HARD_LIGHT: "HARD",
  RIM: "BACKLIT",
  RIM_LIGHT: "BACKLIT",
  MAGIC_HOUR: "GOLDEN_HOUR",
  SUNSET: "GOLDEN_HOUR",
  NIGHT: "MOONLIT",
  MOONLIGHT: "MOONLIT",
  CHIAROSCURO: "LOW_KEY",
  PRACTICALS: "PRACTICAL",
};
const SHOT_COMPOSITION_SYNONYMS: Record<string, ShotComposition> = {
  THIRDS: "RULE_OF_THIRDS",
  RULE_OF_THIRD: "RULE_OF_THIRDS",
  SYMMETRY: "SYMMETRICAL",
  CENTER: "CENTERED",
  CENTRAL: "CENTERED",
  FRAME_IN_FRAME: "FRAME_WITHIN_FRAME",
  NEGATIVE: "NEGATIVE_SPACE",
  DIAGONALS: "DIAGONAL",
};
const EMOTION_SYNONYMS: Record<string, Emotion> = {
  HAPPINESS: "JOY",
  HAPPY: "JOY",
  EXCITEMENT: "JOY",
  EXCITED: "JOY",
  AFFECTION: "LOVE",
  CONTENTMENT: "CALM",
  CONTENT: "CALM",
  PEACE: "CALM",
  SERENITY: "CALM",
  GRATITUDE: "RELIEF",
  HEARTBROKEN: "GRIEF",
  HATRED: "RAGE",
  HATE: "RAGE",
  ENVY: "JEALOUSY",
  NERVOUSNESS: "ANXIETY",
  NERVOUS: "ANXIETY",
  HORROR: "SHOCK",
  TERROR: "PANIC",
  SUSPICION: "DOUBT",
  PARANOIA: "ANXIETY",
  AMAZEMENT: "AWE",
  WONDER: "AWE",
  BEWILDERMENT: "CONFUSION",
  EMBARRASSMENT: "SHAME",
  HUMILIATION: "SHAME",
  REJECTION: "BETRAYAL",
  ATTRACTION: "DESIRE",
  CONFIDENCE: "DETERMINATION",
  TENSION: "SUSPENSE",
  ANTICIPATION: "SUSPENSE",
  UNCERTAINTY: "DOUBT",
  INDECISION: "DOUBT",
  HESITATION: "DOUBT",
  RESIGNATION: "EXHAUSTION",
  BOREDOM: "EXHAUSTION",
  APATHY: "EXHAUSTION",
  NUMBNESS: "EXHAUSTION",
  MALICE: "RAGE",
  CRUELTY: "RAGE",
  VENGEANCE: "RAGE",
  CONTEMPT: "RESENTMENT",
  IRRITATION: "FRUSTRATION",
  DEVOTION: "LOVE",
  ACCEPTANCE: "CALM",
};
const EMOTION_INTENSITY_SYNONYMS: Record<string, EmotionIntensity> = {
  MILD: "SUBTLE",
  LOW: "SUBTLE",
  FAINT: "SUBTLE",
  MEDIUM: "MODERATE",
  STRONG: "INTENSE",
  HIGH: "INTENSE",
  OVERWHELMING: "INTENSE",
  EXTREME: "INTENSE",
};

// Every cinematography field is parsed as `unknown` and normalized here
// rather than validated by z.enum, deliberately: one hallucinated value in
// one field of one shot must not reject the whole scene's shot plan. An
// unrecognized value becomes null, which the prompt builder reads as "say
// nothing about this axis" (see buildCameraDirectionBlock in shot-images.ts).
function normalizeEnumValue<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  synonyms: Record<string, T>
): T | null {
  if (typeof raw !== "string") return null;
  // "bird's eye" / "Medium Shot" / "over-the-shoulder" all normalize to the
  // underscored uppercase form the enums and synonym maps are keyed by.
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z_]/g, "");
  if (!key) return null;
  if ((allowed as readonly string[]).includes(key)) return key as T;
  return synonyms[key] ?? null;
}

function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim() || null;
}

// Accepts 85, "85", or "85mm" — models write focal lengths all three ways.
// Clamped rather than rejected: a model that asks for a 1200mm lens wants
// "as long as possible", and 300 delivers that intent.
function normalizeLensMm(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw.replace(/[^\d.]/g, "")) : NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_LENS_MM, Math.max(MIN_LENS_MM, Math.round(value)));
}

interface RawCinematography {
  shotSize?: unknown;
  lensMm?: unknown;
  cameraAngle?: unknown;
  framing?: unknown;
  depthOfField?: unknown;
  focusPoint?: unknown;
  lightingStyle?: unknown;
  composition?: unknown;
  subjectMovement?: unknown;
  // Emotion axis — same Director pass, resolved and normalized alongside
  // cinematography rather than as a second call (see normalizeCinematography
  // below).
  emotion?: unknown;
  emotionIntensity?: unknown;
  facialExpression?: unknown;
  bodyLanguage?: unknown;
}

interface NormalizedCinematography {
  shotSize: ShotSize | null;
  lensMm: number | null;
  cameraAngle: CameraAngle | null;
  framing: ShotFraming | null;
  depthOfField: DepthOfField | null;
  focusPoint: string | null;
  lightingStyle: LightingStyle | null;
  composition: ShotComposition | null;
  subjectMovement: string | null;
  emotion: Emotion | null;
  emotionIntensity: EmotionIntensity | null;
  facialExpression: string | null;
  bodyLanguage: string | null;
}

function normalizeCinematography(raw: RawCinematography): NormalizedCinematography {
  return {
    shotSize: normalizeEnumValue(raw.shotSize, SHOT_SIZES, SHOT_SIZE_SYNONYMS),
    lensMm: normalizeLensMm(raw.lensMm),
    cameraAngle: normalizeEnumValue(raw.cameraAngle, CAMERA_ANGLES, CAMERA_ANGLE_SYNONYMS),
    framing: normalizeEnumValue(raw.framing, SHOT_FRAMINGS, SHOT_FRAMING_SYNONYMS),
    depthOfField: normalizeEnumValue(raw.depthOfField, DEPTHS_OF_FIELD, DEPTH_OF_FIELD_SYNONYMS),
    focusPoint: normalizeText(raw.focusPoint),
    lightingStyle: normalizeEnumValue(raw.lightingStyle, LIGHTING_STYLES, LIGHTING_STYLE_SYNONYMS),
    composition: normalizeEnumValue(raw.composition, SHOT_COMPOSITIONS, SHOT_COMPOSITION_SYNONYMS),
    subjectMovement: normalizeText(raw.subjectMovement),
    emotion: normalizeEnumValue(raw.emotion, EMOTIONS, EMOTION_SYNONYMS),
    emotionIntensity: normalizeEnumValue(raw.emotionIntensity, EMOTION_INTENSITIES, EMOTION_INTENSITY_SYNONYMS),
    facialExpression: normalizeText(raw.facialExpression),
    bodyLanguage: normalizeText(raw.bodyLanguage),
  };
}

// Shared by both the zod shot schema and the backfill schema — `unknown` on
// purpose (see normalizeEnumValue above for why nothing here is z.enum).
const cinematographyShape = {
  shotSize: z.unknown().optional(),
  lensMm: z.unknown().optional(),
  cameraAngle: z.unknown().optional(),
  framing: z.unknown().optional(),
  depthOfField: z.unknown().optional(),
  focusPoint: z.unknown().optional(),
  lightingStyle: z.unknown().optional(),
  composition: z.unknown().optional(),
  subjectMovement: z.unknown().optional(),
  emotion: z.unknown().optional(),
  emotionIntensity: z.unknown().optional(),
  facialExpression: z.unknown().optional(),
  bodyLanguage: z.unknown().optional(),
};

// The vocabulary + scene-level rules, shared verbatim by SHOT_PLANNING and
// the backfill pass so a re-direct can't drift from the original grammar.
const CINEMATOGRAPHY_INSTRUCTIONS = `Direct this scene as a cinematographer, not just a list of framings. Resolve these fields per shot — every one is optional, and leaving a field out is a real choice: omit it when the shot doesn't call for a deliberate decision on that axis. Do not fill every field on every shot with a safe default; an unstated field lets the image model decide, which is better than a bland one.
- shotSize: ${SHOT_SIZES.join(" | ")}
- lensMm: focal length in mm, ${MIN_LENS_MM}-${MAX_LENS_MM} (e.g. 24 for a wide establishing frame, 85 for an intimate close-up)
- cameraAngle: ${CAMERA_ANGLES.join(" | ")}
- framing: ${SHOT_FRAMINGS.join(" | ")}
- depthOfField: ${DEPTHS_OF_FIELD.join(" | ")}
- focusPoint: what the eye should land on, in a few words (e.g. "Arjun's hands on the hilt")
- lightingStyle: ${LIGHTING_STYLES.join(" | ")}
- composition: ${SHOT_COMPOSITIONS.join(" | ")}
- subjectMovement: how the subjects move within the frame, including screen direction (e.g. "Arjun strides in from frame-left and stops at centre") — this is what the SUBJECT does, never what the camera does

You are directing the whole scene in one pass, so treat the shots as a continuous sequence, not independent images:
- Lighting is a scene-level constant. Decide the scene's light once — source, direction, time of day, quality — and give every shot the same lightingStyle. Change it mid-scene only when the story itself changes it (a door opens, a lamp is snuffed, time passes), and when you do, say why in that shot's continuityNotes. Adjacent shots in one continuous moment must never drift between different lighting looks.
- Respect the 180-degree line. Fix the scene's axis from the first shot's geography and keep every later camera on the same side of it, so a character facing frame-right keeps facing frame-right. Keep screen direction consistent in subjectMovement for the same reason: someone who exits frame-right enters the next shot from frame-left.
- Vary shotSize and cameraAngle deliberately across the sequence — that variation is what makes a scene read as edited rather than static — but never at the cost of the two rules above.`;

// The emotion vocabulary + rules, shared verbatim by SHOT_PLANNING and the
// backfill pass, same reasoning as CINEMATOGRAPHY_INSTRUCTIONS above.
const EMOTION_INSTRUCTIONS = `Direct the performance in each shot, not just the camera. Resolve these fields per shot — every one is optional, and leaving a field out is a real choice: omit it when the shot has no deliberate emotional beat (an empty establishing shot of a room, say).
- emotion: ${EMOTIONS.join(" | ")}
- emotionIntensity: ${EMOTION_INTENSITIES.join(" | ")} — how strongly it reads, not how long it lasts
- facialExpression: concrete and physical, not a restatement of the emotion word (e.g. "jaw tight, eyes narrowed" rather than "looks angry")
- bodyLanguage: posture and physical carriage (e.g. "shoulders drawn in, arms crossed protectively")

Treat a character's emotional state as continuous across the scene the same way you treat lighting: it doesn't reset between shots. Carry a feeling forward at reduced intensity rather than dropping it silently, and only shift it when the story gives a reason — a line of dialogue lands, a reveal happens, an action succeeds or fails. When an emotional shift is significant enough to persist for later shots to know about (a character breaks down, steels themselves, snaps), also record it in that shot's continuity snapshot per the instructions above, using the same subject/state shape (e.g. { "subject": "Arjun", "state": "shaken, hasn't spoken since the ambush" }).`;

// Rough words-per-minute estimate (~150wpm, a common spoken-narration rate)
// used only to give AI-planned ILLUSTRATION shots a sane starting duration
// when the scene already has narration/dialogue text written at
// shot-planning time — the per-shot Duration field (shot-manager.tsx) stays
// the real source of truth once a human, or the Audio Cue Plan step
// (audio-cue-plan.ts), reviews it. When there's no script yet — the normal
// picture-first order Phase 11 expects — this is skipped entirely and shots
// keep today's null/DEFAULT_ILLUSTRATION_SECONDS fallback (see
// lib/illustration-timing.ts).
const WORDS_PER_SECOND = 150 / 60;
const MIN_ESTIMATED_SHOT_SECONDS = 1;

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function estimateShotDurations(
  scene: { narration: string | null; dialogueLines: { text: string }[] },
  shotCount: number
): number[] | null {
  const words = countWords(scene.narration ?? "") + scene.dialogueLines.reduce((sum, l) => sum + countWords(l.text), 0);
  if (words === 0) return null;
  const perShot = Math.max(MIN_ESTIMATED_SHOT_SECONDS, Math.round(words / WORDS_PER_SECOND / shotCount));
  return Array(shotCount).fill(perShot);
}

const aiShotsResponseSchema = z.object({
  shots: z
    .array(
      z.object({
        description: z.string().min(1),
        cameraMovement: z.enum(CAMERA_MOVEMENTS).nullable().optional(),
        continuityNotes: z.string().nullable().optional(),
        // Resolved continuity snapshot — what IS true as of this shot, not
        // what changed. See Shot.continuity in schema.prisma for why this is
        // a snapshot rather than a diff.
        continuity: z
          .array(
            z.object({
              subject: z.string().min(1),
              state: z.string().min(1),
            })
          )
          .nullable()
          .optional(),
        ...cinematographyShape,
      })
    )
    .min(1),
  reason: z.string().nullable().optional(),
  // Scene-level closing state — see Scene.closingState in schema.prisma.
  // Complements per-shot continuity (characters/objects) with categories
  // that live at the scene level: environment, unfinished actions, spatial
  // layout, hard continuity anchors, and the cause->effect story state.
  closingState: z
    .object({
      environment: z
        .object({
          location: z.string().nullable().optional(),
          timeOfDay: z.string().nullable().optional(),
          weather: z.string().nullable().optional(),
          lighting: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      unfinishedActions: z.string().nullable().optional(),
      spatialNotes: z.string().nullable().optional(),
      continuityAnchors: z
        .array(z.object({ subject: z.string().min(1), mustNotChange: z.string().min(1) }))
        .nullable()
        .optional(),
      storyState: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word
// "JSON" appears below to satisfy the provider's json_object requirement.
const SHOT_PLANNING_SYSTEM_PROMPT = `You are the Shot Engine inside Narrata, a manual-first AI story/video production studio.
Break the scene below into an ordered sequence of distinct shots — successive camera compositions that together tell the scene, each one a different moment or framing. Shots are continuity, not alternates: shot 2 continues on from shot 1, it never re-describes the same instant.

Pick a shot count that suits the scene's actual content — a short exchange might need only 1-2 shots; a scene with several dialogue exchanges or a change in action typically wants roughly one shot per speaker change or story beat. Don't pad the count for its own sake.

For each shot, also decide whether anything changes by the end of it that the NEXT shot needs to know — a prop picked up or dropped, a wardrobe or visible physical change, a position/pose that carries forward. When something does, write it as continuityNotes: a short, concrete note using canonical names (e.g. "Arjun is now holding the iron sword in his right hand"). Leave it null when nothing carries forward — most shots will.

Also track continuity as a resolved snapshot, not a diff: a list of { subject, state } entries stating what IS currently true for any named character, prop, or location whose state differs from its normal/bible appearance — never what just changed. Carry every still-true entry forward from earlier shots in this scene even if this shot doesn't mention it again (an injury from shot 2 is still true in shot 6 unless something resolves it), and add or update entries as new changes happen. Include emotional and physical condition when it carries across shots (e.g. { "subject": "Arjun", "state": "shaken, hands unsteady since the ambush" }) — a performance that silently resets between adjacent shots reads as broken the same way a vanishing prop does. Use the same canonical names as continuityNotes. Leave the list empty when nothing differs from baseline yet.

When a "# State carried in from the previous scene" section is present, it lists what was true at the end of the scene before this one — but a scene break often means time has passed or the setting has changed, so don't carry it forward automatically the way you would between two adjacent shots in the same scene. Use judgment: seed shot 1's continuity snapshot with whatever from that list would plausibly still be true (a lasting injury, a wardrobe change, an emotional aftermath, a prop the character would still be carrying), and drop anything a break naturally resolves (a mid-action pose, a transient expression). Then continue tracking normally from there. A camera setup named in that section is reference only — a new scene normally resets the camera; only echo it if you're deliberately choosing a match cut.

Alongside the shots, also resolve this scene's own closingState — what's true as of the LAST shot, for categories that don't belong on any single shot:
- environment: { location, timeOfDay, weather, lighting } — only the fields that are actually established or that changed during the scene; leave a field out if the scene never establishes it.
- unfinishedActions: an action left mid-execution that the next scene should know is still incomplete (e.g. "Arjun was still climbing the wall when the scene cut away"), or null if the scene resolves cleanly.
- spatialNotes: where key characters/objects ended up relative to each other or the space, when it matters for what comes next.
- continuityAnchors: a list of { subject, mustNotChange } for details that are load-bearing for the story and must not drift later (a birthmark, a specific weapon, a name) — distinct from continuity's routine state tracking, this is for facts nothing should ever contradict.
- storyState: one or two sentences of cause -> effect -> current situation, e.g. "Arjun confronted the guard and was recognized; he's now a wanted man in this city."
Leave any field null/empty when the scene genuinely has nothing to say for it — don't invent detail to fill every field.

${CINEMATOGRAPHY_INSTRUCTIONS}

Pick each shot's cameraMovement from this list, respecting the distinction each one names — these are different shots, not synonyms, and the most common mistake is writing a dolly as a zoom:
${CAMERA_MOVEMENTS_PROMPT_LIST}
Choose STATIC freely: a still frame is a real choice, and a scene where every shot moves is more tiring than one where three of five hold.

${EMOTION_INSTRUCTIONS}

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "shots": [
    { "description": "what's on screen in this shot: framing, subject, action, expression", "cameraMovement": one of ${CAMERA_MOVEMENTS.join(" | ")}, "continuityNotes": "state that carries into the next shot, or null", "continuity": [ { "subject": "Arjun", "state": "holding the iron sword in his right hand, left sleeve torn" } ], "shotSize": "MEDIUM_CLOSE_UP", "lensMm": 85, "cameraAngle": "LOW", "framing": "SINGLE", "depthOfField": "SHALLOW", "focusPoint": "Arjun's hands on the hilt", "lightingStyle": "LOW_KEY", "composition": "RULE_OF_THIRDS", "subjectMovement": "Arjun strides in from frame-left and stops at centre", "emotion": "DETERMINATION", "emotionIntensity": "MODERATE", "facialExpression": "jaw set, eyes fixed on the blade", "bodyLanguage": "shoulders squared, weight forward onto the front foot" }
  ],
  "reason": "one sentence explaining the shot count and how it splits the scene",
  "closingState": { "environment": { "location": "the guard post at the city gate", "timeOfDay": "dusk", "weather": null, "lighting": "torchlit" }, "unfinishedActions": null, "spatialNotes": "Arjun is now inside the gate, the guard behind him", "continuityAnchors": [ { "subject": "Arjun", "mustNotChange": "carries his father's iron sword" } ], "storyState": "Arjun talked his way past the gate guard; he's inside the city now but the guard suspects something." }
}
Any cinematography or emotion field you have no deliberate choice for must be null, not guessed.`;

interface GenerateShotsParams {
  sceneId: string;
  modelId: string;
  regenerateAll: boolean;
}

interface GenerateShotsResult {
  shots: ReturnType<typeof mapShotsImages>;
  reason: string | null;
}

export async function generateShots({ sceneId, modelId, regenerateAll }: GenerateShotsParams): Promise<GenerateShotsResult> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      dialogueLines: { orderBy: { order: "asc" }, include: { character: { select: { name: true } } } },
    },
  });

  if (!regenerateAll) {
    const existingCount = await prisma.shot.count({ where: { sceneId } });
    if (existingCount > 0) {
      throw new ShotsExistError(existingCount);
    }
  }

  const dialogueBlock = scene.dialogueLines.map((l) => `${l.character.name}: ${l.text}`).join("\n");

  // Closing state of whatever scene precedes this one (chases episode/season
  // boundaries too — see scene-continuity.ts) so shot 1's continuity snapshot
  // isn't drafted blind to what was true a moment before this scene opened.
  const previousSceneShot = await findLastShotOfPreviousScene(scene);
  const previousSceneFacts = previousSceneShot
    ? [
        ...parseContinuitySnapshot(previousSceneShot.continuity).map((e) => `${e.subject} — ${e.state}`),
        previousSceneShot.continuityNotes,
      ].filter((v): v is string => Boolean(v))
    : [];
  // Phase 2 — camera is informational only (see system prompt: "reference
  // only... only echo it if deliberately choosing a match cut"), never a
  // directive the way it is for an in-scene previous shot.
  const previousCameraLine = previousSceneShot
    ? [
        previousSceneShot.shotSize && SHOT_SIZE_LABELS[previousSceneShot.shotSize],
        previousSceneShot.cameraAngle && `${CAMERA_ANGLE_LABELS[previousSceneShot.cameraAngle]} angle`,
        `camera ${previousSceneShot.cameraMovement}`,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  // Phase 1 — the previous scene's own closingState (environment/actions/
  // spatial/anchors/story-state), complementing the character/object facts
  // above which come from its last shot instead.
  const previousClosingState = parseClosingState(await findPreviousSceneClosingState(scene));
  const previousSceneLines = [
    ...previousSceneFacts,
    previousCameraLine && `Camera setup: ${previousCameraLine}`,
    ...describeClosingState(previousClosingState),
  ];

  const userPrompt = [
    `# Scene\n${scene.description}`,
    scene.narration?.trim() && `# Narration\n${scene.narration}`,
    dialogueBlock && `# Dialogue\n${dialogueBlock}`,
    previousSceneLines.length > 0 && `# State carried in from the previous scene\n${previousSceneLines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: SHOT_PLANNING_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = aiShotsResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const estimatedDurations =
    scene.visualMode === "ILLUSTRATION" ? estimateShotDurations(scene, parsed.data.shots.length) : null;

  const shots = await prisma.$transaction(async (tx) => {
    if (regenerateAll) {
      await tx.shot.deleteMany({ where: { sceneId } });
    }
    const created: Prisma.ShotGetPayload<{ include: typeof SHOT_INCLUDE }>[] = [];
    for (const [index, s] of parsed.data.shots.entries()) {
      created.push(
        await tx.shot.create({
          data: {
            sceneId,
            order: index + 1,
            description: s.description,
            cameraMovement: (s.cameraMovement ?? "STATIC") as CameraMovement,
            durationSeconds: estimatedDurations?.[index] ?? null,
            continuityNotes: s.continuityNotes ?? null,
            continuity:
              s.continuity && s.continuity.length > 0 ? (s.continuity as Prisma.InputJsonValue) : Prisma.JsonNull,
            ...normalizeCinematography(s),
          },
          include: SHOT_INCLUDE,
        })
      );
    }
    await tx.scene.update({
      where: { id: sceneId },
      data: {
        closingState: parsed.data.closingState ? (parsed.data.closingState as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    return created;
  });

  return { shots: mapShotsImages(shots), reason: parsed.data.reason ?? null };
}

// ── Direct existing shots (backfill) ──────────────────────────────────────
// Every shot that existed before the cinematography/emotion columns landed
// has all thirteen of them null, and so does any shot a user adds by hand.
// This is the way to fill them in without destroying work: it asks only for
// cinematography and emotion, matches the answer back to existing rows by
// order, and updates nothing but those thirteen columns — descriptions,
// continuity, durations, images and per-shot model overrides are all
// untouched. Same SHOT_PLANNING job type and model (it's the same skill, and
// adding an AiJobType costs two hardcoded-list edits), and the same
// per-scene pass so the lighting-hold, 180-degree-axis and emotional-arc
// rules still apply across the whole sequence rather than shot by shot.

export class NoShotsToDirectError extends Error {
  constructor() {
    super("This scene has no shots to direct yet. Generate or add shots first.");
  }
}

const aiDirectionResponseSchema = z.object({
  shots: z
    .array(
      z.object({
        order: z.number().int().nullable().optional(),
        ...cinematographyShape,
      })
    )
    .min(1),
  reason: z.string().nullable().optional(),
});

const DIRECT_SHOTS_SYSTEM_PROMPT = `You are the Director of Photography and performance director inside Narrata, a manual-first AI story/video production studio.
The scene below is ALREADY broken into an ordered list of shots. Do not add, remove, merge, split or rewrite any shot — the shot list is fixed and final. Your only job is to decide how each existing shot is photographed and performed.

${CINEMATOGRAPHY_INSTRUCTIONS}

${EMOTION_INSTRUCTIONS}

Return exactly one entry per shot, in the same order as the numbered list you are given, echoing each shot's "order" number so the mapping is unambiguous.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "shots": [
    { "order": 1, "shotSize": "WIDE", "lensMm": 24, "cameraAngle": "EYE_LEVEL", "framing": "ESTABLISHING", "depthOfField": "DEEP", "focusPoint": "the sealed stone door", "lightingStyle": "GOLDEN_HOUR", "composition": "SYMMETRICAL", "subjectMovement": "none — the frame holds still", "emotion": "SUSPENSE", "emotionIntensity": "SUBTLE", "facialExpression": null, "bodyLanguage": null }
  ],
  "reason": "one sentence describing the scene's overall visual approach: its light, its axis, and how the coverage varies"
}
Any field you have no deliberate choice for must be null, not guessed.`;

interface DirectExistingShotsParams {
  sceneId: string;
  modelId: string;
}

export async function directExistingShots({ sceneId, modelId }: DirectExistingShotsParams): Promise<GenerateShotsResult> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      dialogueLines: { orderBy: { order: "asc" }, include: { character: { select: { name: true } } } },
      shots: { orderBy: { order: "asc" } },
    },
  });

  if (scene.shots.length === 0) {
    throw new NoShotsToDirectError();
  }

  const dialogueBlock = scene.dialogueLines.map((l) => `${l.character.name}: ${l.text}`).join("\n");
  // Each shot's existing cameraMovement rides along so the Director can pick
  // a size/angle the move actually works with (a ZOOM_IN onto an
  // EXTREME_CLOSE_UP has nowhere to go), and continuityNotes so it can see
  // what physically changes between shots.
  const shotBlock = scene.shots
    .map((s) =>
      [
        `${s.order}. ${s.description}`,
        `   camera movement: ${s.cameraMovement}`,
        s.continuityNotes && `   carries into the next shot: ${s.continuityNotes}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");

  const userPrompt = [
    `# Scene\n${scene.description}`,
    scene.narration?.trim() && `# Narration\n${scene.narration}`,
    dialogueBlock && `# Dialogue\n${dialogueBlock}`,
    `# Shots to direct (${scene.shots.length}, fixed — return exactly this many, in this order)\n${shotBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: DIRECT_SHOTS_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = aiDirectionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  // Rejected rather than zipped-as-far-as-it-goes: a count mismatch means the
  // model re-planned the scene instead of directing it, and silently applying
  // shot 3's lighting to shot 5 is worse than doing nothing. The user can
  // retry — no rows were touched.
  if (parsed.data.shots.length !== scene.shots.length) {
    throw new OpenRouterError(
      `AI returned direction for ${parsed.data.shots.length} shot(s) but this scene has ${scene.shots.length}. Nothing was changed — try again.`
    );
  }
  // Same guard one level finer: the echoed order numbers must line up with
  // the real ones, so a reordered answer can't be applied to the wrong rows.
  const misordered = parsed.data.shots.some(
    (s, i) => s.order != null && s.order !== scene.shots[i].order
  );
  if (misordered) {
    throw new OpenRouterError("AI returned direction in a different shot order than it was given. Nothing was changed — try again.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result: Prisma.ShotGetPayload<{ include: typeof SHOT_INCLUDE }>[] = [];
    for (const [index, direction] of parsed.data.shots.entries()) {
      result.push(
        await tx.shot.update({
          where: { id: scene.shots[index].id },
          // Only the thirteen cinematography/emotion columns — never
          // description, continuity, duration, order or images.
          data: normalizeCinematography(direction),
          include: SHOT_INCLUDE,
        })
      );
    }
    return result;
  });

  return { shots: mapShotsImages(updated), reason: parsed.data.reason ?? null };
}
