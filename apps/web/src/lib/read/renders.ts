import type { RenderItem, RendersResponse } from "contract";
import { prisma } from "@/lib/db";
import { mediaRef } from "./media";

type RenderAsset = {
  id: string;
  isSelected: boolean;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: unknown;
  createdAt: Date;
  language: string | null;
};

function toRenderItem(asset: RenderAsset, kind: RenderItem["kind"]): RenderItem {
  return {
    assetId: asset.id,
    kind,
    isSelected: asset.isSelected,
    media: mediaRef(asset)!,
    language: asset.language,
    createdAt: asset.createdAt.toISOString(),
    downloadUrl: `/api/storage/${asset.storageKey}?download=1`,
  };
}

// GET /api/mobile/v1/projects/:id/renders — mobile-app-ux-plan §4.6's "Ship"
// surface. Every take of both final and silent renders, all episodes for a
// SERIES project included via the same cross-episode OR the hero query in
// project-detail.ts uses — no ownership check here, this relies on the
// caller having already gone through proxy.ts's RESOLVERS entry for
// /api/mobile/v1/projects/:id (its regex has no trailing anchor, so it
// already covers this nested route too — same pattern as the original
// /api/projects/[id]/... entry covering ~20 sub-routes).
export async function getRenders(projectId: string): Promise<RendersResponse> {
  const selectFields = {
    id: true,
    isSelected: true,
    storageKey: true,
    mimeType: true,
    sizeBytes: true,
    metadata: true,
    createdAt: true,
    language: true,
  } as const;

  const [finals, silents] = await Promise.all([
    prisma.asset.findMany({
      where: {
        type: "FINAL_VIDEO",
        language: null,
        OR: [{ storyVideo: { projectId } }, { episodeVideo: { season: { projectId } } }],
      },
      orderBy: { createdAt: "desc" },
      select: selectFields,
    }),
    prisma.asset.findMany({
      where: {
        type: "SILENT_VIDEO",
        OR: [{ storySilentVideo: { projectId } }, { episodeSilentVideo: { season: { projectId } } }],
      },
      orderBy: { createdAt: "desc" },
      select: selectFields,
    }),
  ]);

  const renders = [
    ...finals.map((a) => toRenderItem(a, "finalAssembly")),
    ...silents.map((a) => toRenderItem(a, "silentAssembly")),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { renders };
}
