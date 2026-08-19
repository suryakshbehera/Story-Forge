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
  };
}
