import { prisma } from "@/lib/db";

// Asset has 13 different optional parent FKs and no direct projectId (see
// proxy.ts's storage-route comment for the original statement of this
// problem). Every mobile-only Asset mutation that isn't already behind one
// of the existing web routes (which resolve ownership their own way) needs
// this same resolution — the "Keep" endpoint (mobile-technical-plan-
// 2026-09-14 §5.1) is the first, and the storage route's future signed-URL
// work (§3.2/B9) will need the same thing. Write it once, here.
export async function resolveAssetProjectId(assetId: string): Promise<string | null> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      characterId: true,
      locationId: true,
      shotId: true,
      narrationSceneId: true,
      dialogueLineId: true,
      videoSceneId: true,
      musicSceneId: true,
      sfxSceneId: true,
      storyVideoId: true,
      episodeVideoId: true,
      storySilentVideoId: true,
      episodeSilentVideoId: true,
      projectStyleId: true,
      projectSourceId: true,
      projectCoverId: true,
    },
  });
  if (!asset) return null;

  if (asset.characterId) {
    return (await prisma.character.findUnique({ where: { id: asset.characterId }, select: { projectId: true } }))?.projectId ?? null;
  }
  if (asset.locationId) {
    return (await prisma.location.findUnique({ where: { id: asset.locationId }, select: { projectId: true } }))?.projectId ?? null;
  }
  if (asset.projectStyleId) return asset.projectStyleId;
  if (asset.projectSourceId) return asset.projectSourceId;
  if (asset.projectCoverId) return asset.projectCoverId;

  if (asset.shotId) {
    const shot = await prisma.shot.findUnique({
      where: { id: asset.shotId },
      select: { scene: { select: { story: { select: { projectId: true } }, episode: { select: { season: { select: { projectId: true } } } } } } },
    });
    return shot?.scene.story?.projectId ?? shot?.scene.episode?.season.projectId ?? null;
  }

  const sceneId = asset.narrationSceneId ?? asset.videoSceneId ?? asset.musicSceneId ?? asset.sfxSceneId;
  if (sceneId) {
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      select: { story: { select: { projectId: true } }, episode: { select: { season: { select: { projectId: true } } } } },
    });
    return scene?.story?.projectId ?? scene?.episode?.season.projectId ?? null;
  }

  if (asset.dialogueLineId) {
    const line = await prisma.dialogueLine.findUnique({
      where: { id: asset.dialogueLineId },
      select: { scene: { select: { story: { select: { projectId: true } }, episode: { select: { season: { select: { projectId: true } } } } } } },
    });
    return line?.scene.story?.projectId ?? line?.scene.episode?.season.projectId ?? null;
  }

  if (asset.storyVideoId || asset.storySilentVideoId) {
    const storyId = asset.storyVideoId ?? asset.storySilentVideoId!;
    return (await prisma.story.findUnique({ where: { id: storyId }, select: { projectId: true } }))?.projectId ?? null;
  }
  if (asset.episodeVideoId || asset.episodeSilentVideoId) {
    const episodeId = asset.episodeVideoId ?? asset.episodeSilentVideoId!;
    const episode = await prisma.episode.findUnique({ where: { id: episodeId }, select: { season: { select: { projectId: true } } } });
    return episode?.season.projectId ?? null;
  }

  return null;
}
