// Per-job-type staleness thresholds for the in-flight generation lock
// pattern (see Shot.imageGenerationStartedAt in schema.prisma for the
// original, proven version of this contract). A single dialogue line's TTS
// call and a full ffmpeg final-render are not the same order of magnitude,
// so — unlike the original single IMAGE_GENERATION_STALE_MS constant — this
// is a table, generous above each job's realistic worst case so a claim only
// goes stale after a run that genuinely could not still be in progress.
export const STALE_MS = {
  shotImage: 8 * 60 * 1000,
  narration: 3 * 60 * 1000,
  dialogueAudio: 3 * 60 * 1000,
  video: 10 * 60 * 1000,
  music: 5 * 60 * 1000,
  sfx: 5 * 60 * 1000,
  silentAssembly: 8 * 60 * 1000,
  finalAssembly: 15 * 60 * 1000,
} as const;

export type GenerationJobType = keyof typeof STALE_MS;

// Which AiJobType's GenerationEvent history backs each GenerationJobType's
// cost/duration estimate — a claim or a review-queue slot only knows its
// GenerationJobType, not the AiJobType a metered call is recorded under.
// Shared by lib/read/activity.ts (job tray ETAs) and lib/read/review-
// queue.ts (actions.estimateJobType) — was duplicated in the former until
// the latter needed the identical mapping.
export const ESTIMATE_JOB_TYPE: Record<GenerationJobType, "IMAGE_GENERATION" | "VOICE" | "VIDEO_GENERATION" | "MUSIC_GENERATION" | "SFX_GENERATION" | "VIDEO"> = {
  shotImage: "IMAGE_GENERATION",
  narration: "VOICE",
  dialogueAudio: "VOICE",
  video: "VIDEO_GENERATION",
  music: "MUSIC_GENERATION",
  sfx: "SFX_GENERATION",
  silentAssembly: "VIDEO",
  finalAssembly: "VIDEO",
};

export function isGenerationActive(startedAt: string | Date | null | undefined, jobType: GenerationJobType): boolean {
  if (!startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() < STALE_MS[jobType];
}

// Human-readable stage name per job type — distinct from InFlightJob.label
// below, which names the *entity* ("Shot 3", "Scene 2"). The job tray shows
// both: stage says what kind of work is running, label says on what.
export const STAGE_LABELS: Record<GenerationJobType, string> = {
  shotImage: "Image generation",
  narration: "Narration",
  dialogueAudio: "Dialogue audio",
  video: "Video generation",
  music: "Music generation",
  sfx: "SFX generation",
  silentAssembly: "Silent assembly",
  finalAssembly: "Final render",
};

// Shared shape for the header's job tray — one entry per currently-active
// claim, resolved server-side in lib/read/activity.ts (both
// app/api/projects/[id]/jobs/route.ts and the mobile BFF's
// GET /api/mobile/v1/activity call the same function now — see
// docs/product/mobile-technical-plan-2026-09.md §1.3 rule 3).
// etaSeconds is the observed-median duration for this job type (see
// GenerationEvent/getGenerationEstimate) minus elapsed time, or null when
// there's not yet enough history to estimate from.
export interface InFlightJob {
  jobType: GenerationJobType;
  stage: string;
  label: string;
  startedAt: string;
  href: string;
  etaSeconds: number | null;
  // Scene/Shot/DialogueLine/Story/Episode id this claim belongs to — added
  // for the mobile BFF's SlotId construction (`${SlotKind}:${entityId}`,
  // see packages/contract). Web's job-tray.tsx doesn't read it; it's not a
  // breaking addition to a type nothing else constructs.
  entityId: string;
}
