import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@/lib/db";
import { isGenerationActive, type InFlightJob } from "@/lib/generation-claims";

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

  const jobs: InFlightJob[] = [];

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

  jobs.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return NextResponse.json({ jobs });
}
