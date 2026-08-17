// Shared between the server (claiming/releasing the lock, deciding whether a
// claim is stale) and the client (deciding whether to render a persisted
// "Generating…" state on load) — kept free of any imports so the client
// bundle doesn't pull in Prisma/storage/OpenRouter via lib/shot-images.ts.
//
// Set generously above the realistic worst case for one generateShotImage()
// call (image-prompt chat call + image call + validation call, each capped
// at 120-180s in lib/ai/openrouter.ts's fetchWithTimeout — see that file for
// the per-endpoint budgets) so a claim only goes stale after a run that
// genuinely could not still be in progress, e.g. the server crashed before
// its finally block could clear Shot.imageGenerationStartedAt. This is what
// keeps a stale claim from showing a "Generating…" spinner that lies.
export const IMAGE_GENERATION_STALE_MS = 8 * 60 * 1000;

export function isImageGenerationActive(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() < IMAGE_GENERATION_STALE_MS;
}
