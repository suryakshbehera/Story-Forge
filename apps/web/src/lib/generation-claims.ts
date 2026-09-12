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

export function isGenerationActive(startedAt: string | Date | null | undefined, jobType: GenerationJobType): boolean {
  if (!startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() < STALE_MS[jobType];
}

// Shared shape for the header's job tray — one entry per currently-active
// claim, resolved server-side in app/api/projects/[id]/jobs/route.ts.
export interface InFlightJob {
  jobType: GenerationJobType;
  label: string;
  startedAt: string;
  href: string;
}
