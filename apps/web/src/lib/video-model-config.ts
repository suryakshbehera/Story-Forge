// CameraMovement's own values, duplicated here rather than imported from
// @/lib/db — this module is also read by client components (ai-models-manager
// UI) that shouldn't pull in the Prisma client. This module has no imports of
// its own precisely so it can be imported from either side of the boundary.
//
// THE single TypeScript source of truth for the movement list: the zod
// schemas on the shot/scene API routes, SHOT_PLANNING's enum + prompt
// (lib/shots.ts), the shot editor dropdown (shot-manager.tsx) and the
// routing checkboxes (ai-models-manager.tsx) all derive from this array, so
// adding a value here reaches every one of them. Only the Prisma enum in
// schema.prisma has to be kept in step by hand — and a mismatch there is a
// compile error at the call sites that cast to Prisma's CameraMovement, not
// a silent failure.
//
// Order matters for the UI: it's the order the dropdown and the routing
// checkboxes render in, grouped by family (optical, rotation, translation,
// texture) rather than alphabetically.
export const CAMERA_MOVEMENTS = [
  "STATIC",
  // Optical — lens changes, camera body still.
  "ZOOM_IN",
  "ZOOM_OUT",
  "CRASH_ZOOM",
  // Translation toward/away — perspective and parallax change.
  "DOLLY_IN",
  "DOLLY_OUT",
  "DOLLY_ZOOM",
  // Rotation in place.
  "PAN_LEFT",
  "PAN_RIGHT",
  "WHIP_PAN",
  "TILT_UP",
  "TILT_DOWN",
  "ROLL",
  // Body translation.
  "TRACK_LEFT",
  "TRACK_RIGHT",
  "PEDESTAL_UP",
  "PEDESTAL_DOWN",
  "CRANE_UP",
  "CRANE_DOWN",
  // Orbit.
  "ARC_LEFT",
  "ARC_RIGHT",
  // Texture / platform.
  "STEADICAM_FOLLOW",
  "HANDHELD",
  "AERIAL",
] as const;
export type CameraMovementValue = (typeof CAMERA_MOVEMENTS)[number];

// Shape of AiModelOption.config for VIDEO_GENERATION models — admin-entered
// in Settings -> AI Models (ai-models-manager.tsx), since OpenRouter has no
// confirmed public endpoint for querying a model's duration/resolution/audio
// capabilities live. A model with no config keeps the pre-existing
// unconstrained-duration, no-resolution, audio-toggle-has-no-guaranteed-effect
// behavior.
export interface VideoModelConfig {
  durationMode: "fixed" | "range";
  // "fixed" mode: the exact clip lengths (seconds) the model accepts, e.g.
  // Veo 3.1 Lite's [4, 6, 8].
  fixedDurations?: number[];
  // "range" mode: a continuous span, e.g. 1-15s.
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  // Available resolutions, e.g. ["480p", "720p"]; first entry is the default.
  resolutions?: string[];
  supportsNativeAudio?: boolean;
  // Whether the model honors an end-frame conditioning image (OpenRouter's
  // `lastFrameDataUri` — see generateSceneVideo in scene-video.ts) for a shot
  // pair's closing keyframe. Unset/true assumes support, matching the
  // pre-existing "always send it" behavior; set explicitly to false once a
  // model is confirmed to ignore or mishandle it, so scene-video.ts stops
  // sending a parameter that model silently drops.
  supportsLastFrame?: boolean;
  // Camera movements this model should be auto-routed for when a shot has no
  // manual Shot.videoModelId override — see resolvePairModel() in
  // scene-video.ts. Multiple enabled models can list the same movement; the
  // first match (isDefault desc, then displayName) wins, same ordering
  // listModelsForJob already uses everywhere else.
  preferredCameraMovements?: CameraMovementValue[];
}

export function parseVideoModelConfig(config: unknown): VideoModelConfig | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (c.durationMode !== "fixed" && c.durationMode !== "range") return null;
  return {
    durationMode: c.durationMode,
    fixedDurations: Array.isArray(c.fixedDurations) ? c.fixedDurations.filter((n): n is number => typeof n === "number") : undefined,
    minDurationSeconds: typeof c.minDurationSeconds === "number" ? c.minDurationSeconds : undefined,
    maxDurationSeconds: typeof c.maxDurationSeconds === "number" ? c.maxDurationSeconds : undefined,
    resolutions: Array.isArray(c.resolutions) ? c.resolutions.filter((r): r is string => typeof r === "string") : undefined,
    supportsNativeAudio: typeof c.supportsNativeAudio === "boolean" ? c.supportsNativeAudio : undefined,
    supportsLastFrame: typeof c.supportsLastFrame === "boolean" ? c.supportsLastFrame : undefined,
    preferredCameraMovements: Array.isArray(c.preferredCameraMovements)
      ? c.preferredCameraMovements.filter((m): m is CameraMovementValue => CAMERA_MOVEMENTS.includes(m as CameraMovementValue))
      : undefined,
  };
}
