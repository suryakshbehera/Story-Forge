import type {
  Shot,
  ShotSize,
  CameraAngle,
  ShotFraming,
  DepthOfField,
  LightingStyle,
  ShotComposition,
} from "@/lib/db";

// Director AI cinematography, rendered as film-grammar prose. Lives here
// rather than in shot-images.ts because two pipelines now read it: the image
// prompt (buildCameraDirectionBlock/cinematographyTail in shot-images.ts) and
// the Image→Video pair prompt (shotDirectionInstruction in scene-video.ts).
// The shot-images.ts copy was the original; this is a move, not a fork —
// there must stay exactly one wording per enum value, or the still and the
// clip generated from it would be directed in subtly different language.
//
// Only non-null fields are ever rendered by either consumer: null means the
// Director deliberately said nothing about that axis (see the enum block in
// schema.prisma), and the prompt stays silent rather than asserting a bland
// default.

export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  EXTREME_WIDE: "extreme wide shot",
  WIDE: "wide shot",
  FULL: "full shot",
  MEDIUM: "medium shot",
  MEDIUM_CLOSE_UP: "medium close-up",
  CLOSE_UP: "close-up",
  EXTREME_CLOSE_UP: "extreme close-up",
};

export const CAMERA_ANGLE_LABELS: Record<CameraAngle, string> = {
  EYE_LEVEL: "eye-level angle",
  LOW: "low angle, looking up at the subject",
  HIGH: "high angle, looking down at the subject",
  OVERHEAD: "overhead bird's-eye angle",
  DUTCH: "dutch (canted) angle",
  OVER_THE_SHOULDER: "over-the-shoulder angle",
  POV: "point-of-view angle, as the character sees it",
};

export const SHOT_FRAMING_LABELS: Record<ShotFraming, string> = {
  SINGLE: "single (one subject in frame)",
  TWO_SHOT: "two-shot",
  THREE_SHOT: "three-shot",
  GROUP: "group shot",
  INSERT: "insert (isolated detail)",
  ESTABLISHING: "establishing shot",
};

export const DEPTH_OF_FIELD_LABELS: Record<DepthOfField, string> = {
  SHALLOW: "shallow depth of field, background thrown out of focus",
  MEDIUM: "moderate depth of field",
  DEEP: "deep focus, foreground and background both sharp",
};

export const LIGHTING_STYLE_LABELS: Record<LightingStyle, string> = {
  NATURAL: "natural light",
  SOFT: "soft, diffused light",
  HARD: "hard directional light with crisp shadows",
  HIGH_KEY: "high-key lighting, bright and low-contrast",
  LOW_KEY: "low-key lighting, deep shadows and strong contrast",
  BACKLIT: "backlit, with rim light separating the subject",
  SILHOUETTE: "silhouetted against the light",
  GOLDEN_HOUR: "golden-hour light, warm and low",
  MOONLIT: "moonlight, cool and dim",
  PRACTICAL: "lit by practical sources visible in the frame",
};

export const SHOT_COMPOSITION_LABELS: Record<ShotComposition, string> = {
  CENTERED: "centered composition",
  RULE_OF_THIRDS: "rule-of-thirds composition",
  SYMMETRICAL: "symmetrical composition",
  LEADING_LINES: "leading lines drawing the eye to the subject",
  FRAME_WITHIN_FRAME: "frame-within-a-frame composition",
  NEGATIVE_SPACE: "composition built on negative space",
  DIAGONAL: "diagonal composition",
};

export type ShotCinematography = Pick<
  Shot,
  | "shotSize"
  | "lensMm"
  | "cameraAngle"
  | "framing"
  | "depthOfField"
  | "focusPoint"
  | "lightingStyle"
  | "composition"
  | "subjectMovement"
>;

// True once the Director has resolved *any* camera field for this shot.
// Drives the image pipeline's switch between "honor the resolved framing"
// and "compose something fresh", and the video pipeline's decision whether
// draftMotionPrompt may invent its own camera direction.
export function hasCameraDirection(shot: ShotCinematography): boolean {
  return (
    shot.shotSize !== null ||
    shot.lensMm !== null ||
    shot.cameraAngle !== null ||
    shot.framing !== null ||
    shot.depthOfField !== null ||
    shot.focusPoint !== null ||
    shot.lightingStyle !== null ||
    shot.composition !== null ||
    shot.subjectMovement !== null
  );
}
