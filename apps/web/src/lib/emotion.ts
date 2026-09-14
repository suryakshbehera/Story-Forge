import type { Shot, Emotion, EmotionIntensity } from "@/lib/db";

// Director AI emotion, rendered as film-grammar prose — same pattern as
// cinematography.ts, one axis over: SHOT_PLANNING resolves both in the same
// call, and both are read by the image prompt (buildEmotionDirectionBlock in
// shot-images.ts). Kept in its own file rather than folded into
// cinematography.ts because the two are read by a third, different consumer
// too: Voice direction (voice.ts) renders emotion but has no use for camera
// fields at all.
//
// Only non-null fields are ever rendered by any consumer: null means the
// Director deliberately said nothing about that axis, same convention as
// every cinematography field.

export const EMOTION_LABELS: Record<Emotion, string> = {
  JOY: "joy",
  LOVE: "love, tenderness",
  HOPE: "hope",
  PRIDE: "pride",
  RELIEF: "relief",
  SADNESS: "sadness",
  GRIEF: "grief, mourning",
  LONELINESS: "loneliness, isolation",
  DESPAIR: "despair, hopelessness",
  NOSTALGIA: "nostalgia, wistful longing for the past",
  ANGER: "anger",
  RAGE: "rage, barely controlled fury",
  FRUSTRATION: "frustration",
  RESENTMENT: "resentment, simmering bitterness",
  FEAR: "fear",
  ANXIETY: "anxiety, unease",
  DREAD: "dread, a slow-building sense of doom",
  PANIC: "panic, overwhelmed and losing control",
  SURPRISE: "surprise",
  SHOCK: "shock, stunned disbelief",
  AWE: "awe, wonder at something greater than oneself",
  CONFUSION: "confusion, disorientation",
  CURIOSITY: "curiosity, intrigued attention",
  SHAME: "shame",
  GUILT: "guilt",
  JEALOUSY: "jealousy, envy",
  BETRAYAL: "betrayal, wounded trust",
  DESIRE: "desire, longing",
  DETERMINATION: "determination, resolve",
  COURAGE: "courage, steeling oneself against fear",
  DEFIANCE: "defiance, open refusal to yield",
  TRIUMPH: "triumph, victorious elation",
  SUSPENSE: "suspense, tense anticipation of what's coming",
  CALM: "calm, at peace",
  DOUBT: "doubt, hesitation, second-guessing",
  EXHAUSTION: "exhaustion, worn down past caring",
};

export const EMOTION_INTENSITY_LABELS: Record<EmotionIntensity, string> = {
  SUBTLE: "subtle — barely surfaces, held mostly under the surface",
  MODERATE: "moderate — clearly readable but controlled",
  INTENSE: "intense — fully unguarded, dominates the performance",
};

export type ShotEmotion = Pick<Shot, "emotion" | "emotionIntensity" | "facialExpression" | "bodyLanguage">;

// True once the Director has resolved *any* emotion field for this shot.
// Mirrors hasCameraDirection in cinematography.ts.
export function hasEmotionDirection(shot: ShotEmotion): boolean {
  return (
    shot.emotion !== null ||
    shot.emotionIntensity !== null ||
    shot.facialExpression !== null ||
    shot.bodyLanguage !== null
  );
}
