import { cache } from "react";
import { prisma, type Prisma, type ProjectType } from "@/lib/db";

export interface ProjectStatus {
  storyDone: boolean;
  characters: { total: number; locked: number };
  locations: { total: number };
  scenes: { total: number };
  shots: { total: number; withImage: number };
  voice: { narratedScenes: number; dialogueLinesVoiced: number; dialogueLinesTotal: number };
  finalRenderCount: number;
  storyHref: string;
  scenesHref: string;
  nextStepHref: string;
}

// Cached per request so layout.tsx (nav status dots) and page.tsx (overview
// dashboard) can both call this without doubling the DB round-trips — React's
// per-request memoization, same idiom as React Query's dedup but built in.
export const getProjectStatus = cache(async (projectId: string, type: ProjectType): Promise<ProjectStatus> => {
  const base = `/projects/${projectId}`;
  const storyHref = type === "SINGLE" ? `${base}/story` : `${base}/bible`;
  // SERIES has no single scene-list route — scenes live per-episode — so
  // anything that needs to point at "the scenes" points at Seasons instead,
  // same call made for SeedanceStudio's empty state in Phase 0.
  const scenesHref = type === "SINGLE" ? `${base}/story/scenes` : `${base}/seasons`;

  const [characterTotal, characterLocked, locationTotal] = await Promise.all([
    prisma.character.count({ where: { projectId } }),
    prisma.character.count({ where: { projectId, isLocked: true } }),
    prisma.location.count({ where: { projectId } }),
  ]);

  let storyDone = false;
  let sceneWhere: Prisma.SceneWhereInput = {};
  let finalRenderWhere: Prisma.AssetWhereInput = { type: "FINAL_VIDEO", isSelected: false };

  if (type === "SINGLE") {
    const story = await prisma.story.findUnique({ where: { projectId }, select: { id: true, content: true } });
    storyDone = Boolean(story?.content?.trim());
    sceneWhere = { storyId: story?.id ?? "__none__" };
    finalRenderWhere = { type: "FINAL_VIDEO", isSelected: true, storyVideo: { projectId } };
  } else {
    const storyBible = await prisma.storyBible.findUnique({ where: { projectId }, select: { content: true } });
    storyDone = Boolean(storyBible?.content?.trim());
    sceneWhere = { episode: { season: { projectId } } };
    finalRenderWhere = { type: "FINAL_VIDEO", isSelected: true, episodeVideo: { season: { projectId } } };
  }

  const [sceneTotal, shotTotal, shotsWithImage, narratedScenes, dialogueLinesTotal, dialogueLinesVoiced, finalRenderCount] =
    await Promise.all([
      prisma.scene.count({ where: sceneWhere }),
      prisma.shot.count({ where: { scene: sceneWhere } }),
      prisma.shot.count({ where: { scene: sceneWhere, images: { some: { isSelected: true } } } }),
      prisma.asset.count({ where: { type: "AUDIO_NARRATION", isSelected: true, narrationScene: sceneWhere } }),
      prisma.dialogueLine.count({ where: { scene: sceneWhere } }),
      prisma.dialogueLine.count({ where: { scene: sceneWhere, audio: { some: { isSelected: true } } } }),
      prisma.asset.count({ where: finalRenderWhere }),
    ]);

  let nextStepHref = scenesHref;
  if (!storyDone) nextStepHref = storyHref;
  else if (sceneTotal === 0) nextStepHref = scenesHref;
  else if (shotsWithImage < shotTotal) nextStepHref = scenesHref;
  else if (narratedScenes === 0 && dialogueLinesVoiced === 0) nextStepHref = scenesHref;
  else if (finalRenderCount === 0) nextStepHref = scenesHref;

  return {
    storyDone,
    characters: { total: characterTotal, locked: characterLocked },
    locations: { total: locationTotal },
    scenes: { total: sceneTotal },
    shots: { total: shotTotal, withImage: shotsWithImage },
    voice: { narratedScenes, dialogueLinesVoiced, dialogueLinesTotal },
    finalRenderCount,
    storyHref,
    scenesHref,
    nextStepHref,
  };
});
