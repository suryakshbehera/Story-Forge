// Shared between video-assembly.ts (server, builds the actual Ken Burns
// clips) and shot-manager.tsx (client, shows a duration hint) so the two
// can't silently drift apart the way the durations here and the stale
// schema.prisma comment already had.
export const DEFAULT_ILLUSTRATION_SECONDS = 5;
export const MIN_SHOT_SECONDS = 0.5;

export function effectiveShotSeconds(durationSeconds: number | null): number {
  return Math.max(durationSeconds ?? DEFAULT_ILLUSTRATION_SECONDS, MIN_SHOT_SECONDS);
}

// Shared "is this actually worth flagging" rule for the shots-total-vs-voice
// hint (shot-manager.tsx) and the post-generation warning (scene-voice-
// panel.tsx) — more than 2s apart, or more than 15% apart on the larger of
// the two, whichever is the bigger gap. Keeps both call sites agreeing on
// what counts as a mismatch instead of each guessing its own threshold.
export function illustrationTimingMismatch(shotsTotalSeconds: number, voiceSeconds: number): boolean {
  const gap = Math.abs(shotsTotalSeconds - voiceSeconds);
  return gap > Math.max(2, 0.15 * Math.max(shotsTotalSeconds, voiceSeconds));
}
