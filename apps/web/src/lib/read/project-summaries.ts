import type { ProjectSummary, ProjectProgress } from "contract";
import { prisma, type Prisma } from "@/lib/db";
import { isGenerationActive } from "@/lib/generation-claims";
import type { CurrentUser } from "@/lib/auth";
import { mediaRef } from "./media";

// The mobile Projects list (mobile-app-ux-plan §4.4) and /me's queue.waiting
// (§10 ask 1) both need this for every project a user owns at once.
// Implementation constraint from mobile-technical-plan-2026-09.md §1.5: do
// NOT loop lib/project-status.ts's getProjectStatus() over the list (~10
// queries EACH). Everything below is ONE nested Prisma call — Postgres does
// the join, this function does the tallying — so the round-trip count stays
// constant as the owned project set grows, which is the property that
// actually matters (not a literal query-count budget).
//
// Only the currently-selected take per slot is fetched (take: 1), and only
// its reviewedAt — never full take history — so this stays cheap regardless
// of how many attempts a slot has accumulated.

const selectedTakeSelect = { where: { isSelected: true as const }, select: { reviewedAt: true }, take: 1 } as const;
const selectedPrimaryLanguageTakeSelect = {
  where: { isSelected: true as const, language: null },
  select: { reviewedAt: true },
  take: 1,
} as const;

const sceneSelect = {
  id: true,
  narrationGenerationStartedAt: true,
  videoGenerationStartedAt: true,
  musicGenerationStartedAt: true,
  sfxGenerationStartedAt: true,
  shots: {
    select: {
      id: true,
      imageGenerationStartedAt: true,
      images: selectedPrimaryLanguageTakeSelect,
    },
  },
  narrationAudio: selectedPrimaryLanguageTakeSelect,
  videoClips: selectedTakeSelect,
  music: selectedTakeSelect,
  sfx: selectedTakeSelect,
  dialogueLines: {
    select: {
      id: true,
      audioGenerationStartedAt: true,
      audio: selectedPrimaryLanguageTakeSelect,
    },
  },
} satisfies Prisma.SceneFindManyArgs["select"];

type RawScene = Prisma.SceneGetPayload<{ select: typeof sceneSelect }>;

export const projectSelect = {
  id: true,
  name: true,
  type: true,
  updatedAt: true,
  coverImage: { select: { storageKey: true, mimeType: true, sizeBytes: true, metadata: true }, take: 1 },
  story: {
    select: {
      content: true,
      silentVideoGenerationStartedAt: true,
      finalVideoGenerationStartedAt: true,
      scenes: { select: sceneSelect },
      finalVideos: selectedPrimaryLanguageTakeSelect,
      silentVideos: selectedTakeSelect,
    },
  },
  storyBible: { select: { content: true } },
  seasons: {
    select: {
      episodes: {
        select: {
          silentVideoGenerationStartedAt: true,
          finalVideoGenerationStartedAt: true,
          scenes: { select: sceneSelect },
          finalVideos: selectedPrimaryLanguageTakeSelect,
          silentVideos: selectedTakeSelect,
        },
      },
    },
  },
  characters: { select: { isLocked: true } },
  locations: { select: { id: true } },
} satisfies Prisma.ProjectFindManyArgs["select"];

export type RawProject = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

interface Tally extends ProjectProgress {
  waitingCount: number;
  runningCount: number;
}

function tallyScenes(scenes: RawScene[]): Pick<
  Tally,
  "scenes" | "shots" | "voice" | "waitingCount" | "runningCount"
> {
  let shotTotal = 0;
  let shotsWithImage = 0;
  let narratedScenes = 0;
  let dialogueLinesTotal = 0;
  let dialogueLinesVoiced = 0;
  let waitingCount = 0;
  let runningCount = 0;

  for (const scene of scenes) {
    if (isGenerationActive(scene.narrationGenerationStartedAt, "narration")) runningCount += 1;
    if (isGenerationActive(scene.videoGenerationStartedAt, "video")) runningCount += 1;
    if (isGenerationActive(scene.musicGenerationStartedAt, "music")) runningCount += 1;
    if (isGenerationActive(scene.sfxGenerationStartedAt, "sfx")) runningCount += 1;

    for (const shot of scene.shots) {
      shotTotal += 1;
      if (isGenerationActive(shot.imageGenerationStartedAt, "shotImage")) runningCount += 1;
      const selected = shot.images[0];
      if (selected) {
        shotsWithImage += 1;
        if (!selected.reviewedAt) waitingCount += 1;
      }
    }

    const selectedNarration = scene.narrationAudio[0];
    if (selectedNarration) {
      narratedScenes += 1;
      if (!selectedNarration.reviewedAt) waitingCount += 1;
    }
    const selectedVideo = scene.videoClips[0];
    if (selectedVideo && !selectedVideo.reviewedAt) waitingCount += 1;
    const selectedMusic = scene.music[0];
    if (selectedMusic && !selectedMusic.reviewedAt) waitingCount += 1;
    const selectedSfx = scene.sfx[0];
    if (selectedSfx && !selectedSfx.reviewedAt) waitingCount += 1;

    for (const line of scene.dialogueLines) {
      dialogueLinesTotal += 1;
      if (isGenerationActive(line.audioGenerationStartedAt, "dialogueAudio")) runningCount += 1;
      const selectedDialogue = line.audio[0];
      if (selectedDialogue) {
        dialogueLinesVoiced += 1;
        if (!selectedDialogue.reviewedAt) waitingCount += 1;
      }
    }
  }

  return {
    scenes: { total: scenes.length },
    shots: { total: shotTotal, withImage: shotsWithImage },
    voice: { narratedScenes, dialogueLinesVoiced, dialogueLinesTotal },
    waitingCount,
    runningCount,
  };
}

function tallyAssembly(parents: {
  silentVideoGenerationStartedAt: Date | null;
  finalVideoGenerationStartedAt: Date | null;
  finalVideos: { reviewedAt: Date | null }[];
  silentVideos: { reviewedAt: Date | null }[];
}[]): { finalRenderCount: number; waitingCount: number; runningCount: number } {
  let finalRenderCount = 0;
  let waitingCount = 0;
  let runningCount = 0;
  for (const parent of parents) {
    if (isGenerationActive(parent.silentVideoGenerationStartedAt, "silentAssembly")) runningCount += 1;
    if (isGenerationActive(parent.finalVideoGenerationStartedAt, "finalAssembly")) runningCount += 1;
    const selectedSilent = parent.silentVideos[0];
    if (selectedSilent && !selectedSilent.reviewedAt) waitingCount += 1;
    const selectedFinal = parent.finalVideos[0];
    if (selectedFinal) {
      finalRenderCount += 1;
      if (!selectedFinal.reviewedAt) waitingCount += 1;
    }
  }
  return { finalRenderCount, waitingCount, runningCount };
}

/** Also used by project-detail.ts against lib/project-status.ts's ProjectStatus, which has the same shape minus `headline` itself. */
export function headlineFor(p: Omit<ProjectProgress, "headline">): string {
  if (!p.storyDone) return "Story not started";
  if (p.scenes.total === 0) return "No scenes yet";
  if (p.shots.withImage < p.shots.total) return `Shots · ${p.shots.withImage} of ${p.shots.total} done`;
  if (p.voice.narratedScenes === 0 && p.voice.dialogueLinesVoiced === 0) return "Voice not started";
  if (p.finalRenderCount === 0) return "Ready for final render";
  return "Complete";
}

/**
 * Flattens a SINGLE project's one Story or a SERIES project's
 * seasons->episodes into the same shape either way, so every caller below
 * (and project-detail.ts, which needs only the waiting/running half of this)
 * tallies scenes and assembly parents identically regardless of project type.
 */
export function flattenProject(project: RawProject) {
  const isSingle = project.type === "SINGLE";
  const scenes = isSingle
    ? (project.story?.scenes ?? [])
    : project.seasons.flatMap((season) => season.episodes.flatMap((episode) => episode.scenes));
  const assemblyParents = isSingle
    ? project.story
      ? [
          {
            silentVideoGenerationStartedAt: project.story.silentVideoGenerationStartedAt,
            finalVideoGenerationStartedAt: project.story.finalVideoGenerationStartedAt,
            finalVideos: project.story.finalVideos,
            silentVideos: project.story.silentVideos,
          },
        ]
      : []
    : project.seasons.flatMap((season) =>
        season.episodes.map((episode) => ({
          silentVideoGenerationStartedAt: episode.silentVideoGenerationStartedAt,
          finalVideoGenerationStartedAt: episode.finalVideoGenerationStartedAt,
          finalVideos: episode.finalVideos,
          silentVideos: episode.silentVideos,
        }))
      );
  const storyDone = isSingle ? Boolean(project.story?.content?.trim()) : Boolean(project.storyBible?.content?.trim());
  return { isSingle, scenes, assemblyParents, storyDone };
}

/** The waiting/running half of summarize(), reused as-is by project-detail.ts so the two never disagree. */
export function tallyProject(project: RawProject): Pick<Tally, "waitingCount" | "runningCount"> {
  const { scenes, assemblyParents } = flattenProject(project);
  const sceneTally = tallyScenes(scenes);
  const assemblyTally = tallyAssembly(assemblyParents);
  return {
    waitingCount: sceneTally.waitingCount + assemblyTally.waitingCount,
    runningCount: sceneTally.runningCount + assemblyTally.runningCount,
  };
}

function summarize(project: RawProject): ProjectSummary {
  const { storyDone, scenes, assemblyParents } = flattenProject(project);
  const sceneTally = tallyScenes(scenes);
  const assemblyTally = tallyAssembly(assemblyParents);

  const progress: ProjectProgress = {
    storyDone,
    characters: {
      total: project.characters.length,
      locked: project.characters.filter((c) => c.isLocked).length,
    },
    locations: { total: project.locations.length },
    scenes: sceneTally.scenes,
    shots: sceneTally.shots,
    voice: sceneTally.voice,
    finalRenderCount: assemblyTally.finalRenderCount,
    headline: "",
  };
  progress.headline = headlineFor(progress);

  return {
    id: project.id,
    name: project.name,
    type: project.type,
    cover: mediaRef(project.coverImage[0] ?? null),
    updatedAt: project.updatedAt.toISOString(),
    progress,
    waitingCount: sceneTally.waitingCount + assemblyTally.waitingCount,
    runningCount: sceneTally.runningCount + assemblyTally.runningCount,
    webHref: `/projects/${project.id}`,
  };
}

// Admin sees every project, same as GET /api/projects — matches proxy.ts's
// RESOLVERS, which already skip the ownership check entirely for ADMIN.
export async function getProjectSummaries(user: CurrentUser): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: user.role === "ADMIN" ? {} : { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: projectSelect,
  });
  return projects.map(summarize);
}

/** Total waiting-review count across every project the user can see — backs GET /api/mobile/v1/me's queue.waiting. */
export async function getTotalWaitingCount(user: CurrentUser): Promise<number> {
  const summaries = await getProjectSummaries(user);
  return summaries.reduce((sum, p) => sum + p.waitingCount, 0);
}
