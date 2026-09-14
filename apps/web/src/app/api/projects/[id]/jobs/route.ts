import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma, type AiJobType } from "@/lib/db";
import { isGenerationActive, STAGE_LABELS, type GenerationJobType, type InFlightJob } from "@/lib/generation-claims";
import { getGenerationEstimate } from "@/lib/generation-events";

// Which AiJobType's GenerationEvent history backs each job's ETA — a job
// tray entry only knows its GenerationJobType (see STALE_MS), not the
// AiJobType a metered call is recorded under, so this bridges the two.
// Deliberately jobType-wide, not model-specific: a job in the tray doesn't
// carry which model it's running without extra per-entity lookups, and a
// same-ballpark ETA is enough for this UI.
const ESTIMATE_JOB_TYPE: Record<GenerationJobType, AiJobType> = {
  shotImage: "IMAGE_GENERATION",
  narration: "VOICE",
  dialogueAudio: "VOICE",
  video: "VIDEO_GENERATION",
  music: "MUSIC_GENERATION",
  sfx: "SFX_GENERATION",
  silentAssembly: "VIDEO",
  finalAssembly: "VIDEO",
};

function etaSecondsFor(medianDurationMs: number | null, startedAt: string): number | null {
  if (medianDurationMs == null) return null;
  const elapsedSeconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
  return Math.max(0, Math.round(medianDurationMs / 1000 - elapsedSeconds));
}

// Backs the header's job tray — one query per claim "slot" (mirrors
// lib/project-status.ts's cheap, no-heavy-include style), scoped to
// whichever scenes/episodes belong to this project. Every entry here is
// something isGenerationActive() would currently call "active"; stale
// claims are filtered out by the same staleness rule the panels use, not
// re-derived here.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const base = `/projects/${id}`;
  const scenesHref = project.type === "SINGLE" ? `${base}/story/scenes` : `${base}/seasons`;

  let sceneWhere: Prisma.SceneWhereInput;
  if (project.type === "SINGLE") {
    const story = await prisma.story.findUnique({ where: { projectId: id }, select: { id: true } });
    sceneWhere = { storyId: story?.id ?? "__none__" };
  } else {
    sceneWhere = { episode: { season: { projectId: id } } };
  }

  type RawJob = Pick<InFlightJob, "jobType" | "label" | "startedAt" | "href">;
  const jobs: RawJob[] = [];

  const [shots, scenes, dialogueLines] = await Promise.all([
    prisma.shot.findMany({
      where: { imageGenerationStartedAt: { not: null }, scene: sceneWhere },
      select: { id: true, order: true, imageGenerationStartedAt: true },
    }),
    prisma.scene.findMany({
      where: {
        ...sceneWhere,
        OR: [
          { narrationGenerationStartedAt: { not: null } },
          { videoGenerationStartedAt: { not: null } },
          { musicGenerationStartedAt: { not: null } },
          { sfxGenerationStartedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        order: true,
        narrationGenerationStartedAt: true,
        videoGenerationStartedAt: true,
        musicGenerationStartedAt: true,
        sfxGenerationStartedAt: true,
      },
    }),
    prisma.dialogueLine.findMany({
      where: { audioGenerationStartedAt: { not: null }, scene: sceneWhere },
      select: { id: true, order: true, audioGenerationStartedAt: true, scene: { select: { order: true } } },
    }),
  ]);

  for (const shot of shots) {
    if (isGenerationActive(shot.imageGenerationStartedAt, "shotImage")) {
      jobs.push({ jobType: "shotImage", label: `Shot ${shot.order} image`, startedAt: shot.imageGenerationStartedAt!.toISOString(), href: scenesHref });
    }
  }
  for (const scene of scenes) {
    if (isGenerationActive(scene.narrationGenerationStartedAt, "narration")) {
      jobs.push({ jobType: "narration", label: `Scene ${scene.order} narration`, startedAt: scene.narrationGenerationStartedAt!.toISOString(), href: scenesHref });
    }
    if (isGenerationActive(scene.videoGenerationStartedAt, "video")) {
      jobs.push({ jobType: "video", label: `Scene ${scene.order} video`, startedAt: scene.videoGenerationStartedAt!.toISOString(), href: scenesHref });
    }
    if (isGenerationActive(scene.musicGenerationStartedAt, "music")) {
      jobs.push({ jobType: "music", label: `Scene ${scene.order} music`, startedAt: scene.musicGenerationStartedAt!.toISOString(), href: scenesHref });
    }
    if (isGenerationActive(scene.sfxGenerationStartedAt, "sfx")) {
      jobs.push({ jobType: "sfx", label: `Scene ${scene.order} sfx`, startedAt: scene.sfxGenerationStartedAt!.toISOString(), href: scenesHref });
    }
  }
  for (const line of dialogueLines) {
    if (isGenerationActive(line.audioGenerationStartedAt, "dialogueAudio")) {
      jobs.push({
        jobType: "dialogueAudio",
        label: `Scene ${line.scene.order} dialogue line ${line.order}`,
        startedAt: line.audioGenerationStartedAt!.toISOString(),
        href: scenesHref,
      });
    }
  }

  if (project.type === "SINGLE") {
    const story = await prisma.story.findUnique({
      where: { projectId: id },
      select: { silentVideoGenerationStartedAt: true, finalVideoGenerationStartedAt: true },
    });
    if (story && isGenerationActive(story.silentVideoGenerationStartedAt, "silentAssembly")) {
      jobs.push({ jobType: "silentAssembly", label: "Silent picture assembly", startedAt: story.silentVideoGenerationStartedAt!.toISOString(), href: scenesHref });
    }
    if (story && isGenerationActive(story.finalVideoGenerationStartedAt, "finalAssembly")) {
      jobs.push({ jobType: "finalAssembly", label: "Final render", startedAt: story.finalVideoGenerationStartedAt!.toISOString(), href: scenesHref });
    }
  } else {
    const episodes = await prisma.episode.findMany({
      where: { season: { projectId: id } },
      select: {
        id: true,
        number: true,
        seasonId: true,
        silentVideoGenerationStartedAt: true,
        finalVideoGenerationStartedAt: true,
      },
    });
    for (const episode of episodes) {
      const episodeHref = `${base}/seasons/${episode.seasonId}/episodes/${episode.id}`;
      if (isGenerationActive(episode.silentVideoGenerationStartedAt, "silentAssembly")) {
        jobs.push({ jobType: "silentAssembly", label: `Episode ${episode.number} silent picture`, startedAt: episode.silentVideoGenerationStartedAt!.toISOString(), href: episodeHref });
      }
      if (isGenerationActive(episode.finalVideoGenerationStartedAt, "finalAssembly")) {
        jobs.push({ jobType: "finalAssembly", label: `Episode ${episode.number} final render`, startedAt: episode.finalVideoGenerationStartedAt!.toISOString(), href: episodeHref });
      }
    }
  }

  const uniqueAiJobTypes = [...new Set(jobs.map((job) => ESTIMATE_JOB_TYPE[job.jobType]))];
  const estimateEntries = await Promise.all(
    uniqueAiJobTypes.map(async (aiJobType) => [aiJobType, await getGenerationEstimate(aiJobType)] as const)
  );
  const estimateByAiJobType = new Map(estimateEntries);

  const enrichedJobs: InFlightJob[] = jobs
    .map((job) => ({
      ...job,
      stage: STAGE_LABELS[job.jobType],
      etaSeconds: etaSecondsFor(estimateByAiJobType.get(ESTIMATE_JOB_TYPE[job.jobType])?.medianDurationMs ?? null, job.startedAt),
    }))
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return NextResponse.json({ jobs: enrichedJobs });
}
