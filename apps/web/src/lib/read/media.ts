import type { MediaRef } from "contract";

// The one place mobile media URLs are minted — see
// docs/product/mobile-technical-plan-2026-09.md §1.3 rule 1 and §3.2. Plain
// login-gated /api/storage/<key> today; becomes a signed URL (once B9/§3.2
// lands, STORAGE_URL_SECRET set) with zero change at any call site, since
// only this function's body changes.
//
// width/height/durationSeconds: nothing in this codebase currently writes
// those into Asset.metadata for images or clips (metadata is used for other
// shapes, e.g. the silent-assembly manifest) — always null today, not a bug.
// Read defensively in case a future assembly/probe step starts populating
// them, so this doesn't need another read-layer change when that lands.
export function mediaRef(asset: {
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata?: unknown;
} | null): MediaRef | null {
  if (!asset) return null;
  const meta =
    asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? (asset.metadata as Record<string, unknown>)
      : null;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return {
    url: `/api/storage/${asset.storageKey}`,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: num(meta?.width),
    height: num(meta?.height),
    durationSeconds: num(meta?.durationSeconds),
  };
}
