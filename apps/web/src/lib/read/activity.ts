import type {
  ActivityResponse,
  ActivityRunningItem,
  ActivityFailureItem,
  ActivityDoneItem,
  SlotId,
} from "contract";
import { prisma, type Prisma, type AiJobType } from "@/lib/db";
import { isGenerationActive, STAGE_LABELS, ESTIMATE_JOB_TYPE, type InFlightJob } from "@/lib/generation-claims";
import { getGenerationEstimate, getActiveFailures, type ActiveFailure } from "@/lib/generation-events";
import type { CurrentUser } from "@/lib/auth";

function etaSecondsFor(medianDurationMs: number | null, startedAt: string): number | null {
  if (medianDurationMs == null) return null;
  const elapsedSeconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
  return Math.max(0, Math.round(medianDurationMs / 1000 - elapsedSeconds));
}

/** One project's active claims — the web job tray's exact original query, now the one place this logic lives. */
export async function getProjectRunningJobs(project: { id: string; type: "SINGLE" | "SERIES" }): Promise<InFlightJob[]> {
  const base = `/projects/${project.id}`;
  const scenesHref = project.type === "SINGLE" ? `${base}/story/scenes` : `${base}/seasons`;

  let sceneWhere: Prisma.SceneWhereInput;
  if (project.type === "SINGLE") {
    const story = await prisma.story.findUnique({ where: { projectId: project.id }, select: { id: true } });
    sceneWhere = { storyId: story?.id ?? "__none__" };
  } else {
    sceneWhere = { episode: { season: { projectId: project.id } } };
  }

  type RawJob = Pick<InFlightJob, "jobType" | "label" | "startedAt" | "href" | "entityId">;
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
      jobs.push({ jobType: "shotImage", label: `Shot ${shot.order} image`, startedAt: shot.imageGenerationStartedAt!.toISOString(), href: scenesHref, entityId: shot.id });
    }
  }
  for (const scene of scenes) {
    if (isGenerationActive(scene.narrationGenerationStartedAt, "narration")) {
      jobs.push({ jobType: "narration", label: `Scene ${scene.order} narration`, startedAt: scene.narrationGenerationStartedAt!.toISOString(), href: scenesHref, entityId: scene.id });
    }
    if (isGenerationActive(scene.videoGenerationStartedAt, "video")) {
      jobs.push({ jobType: "video", label: `Scene ${scene.order} video`, startedAt: scene.videoGenerationStartedAt!.toISOString(), href: scenesHref, entityId: scene.id });
    }
    if (isGenerationActive(scene.musicGenerationStartedAt, "music")) {
      jobs.push({ jobType: "music", label: `Scene ${scene.order} music`, startedAt: scene.musicGenerationStartedAt!.toISOString(), href: scenesHref, entityId: scene.id });
    }
    if (isGenerationActive(scene.sfxGenerationStartedAt, "sfx")) {
      jobs.push({ jobType: "sfx", label: `Scene ${scene.order} sfx`, startedAt: scene.sfxGenerationStartedAt!.toISOString(), href: scenesHref, entityId: scene.id });
    }
  }
  for (const line of dialogueLines) {
    if (isGenerationActive(line.audioGenerationStartedAt, "dialogueAudio")) {
      jobs.push({
        jobType: "dialogueAudio",
        label: `Scene ${line.scene.order} dialogue line ${line.order}`,
        startedAt: line.audioGenerationStartedAt!.toISOString(),
        href: scenesHref,
        entityId: line.id,
      });
    }
  }

  if (project.type === "SINGLE") {
    const story = await prisma.story.findUnique({
      where: { projectId: project.id },
      select: { id: true, silentVideoGenerationStartedAt: true, finalVideoGenerationStartedAt: true },
    });
    if (story && isGenerationActive(story.silentVideoGenerationStartedAt, "silentAssembly")) {
      jobs.push({ jobType: "silentAssembly", label: "Silent picture assembly", startedAt: story.silentVideoGenerationStartedAt!.toISOString(), href: scenesHref, entityId: story.id });
    }
    if (story && isGenerationActive(story.finalVideoGenerationStartedAt, "finalAssembly")) {
      jobs.push({ jobType: "finalAssembly", label: "Final render", startedAt: story.finalVideoGenerationStartedAt!.toISOString(), href: scenesHref, entityId: story.id });
    }
  } else {
    const episodes = await prisma.episode.findMany({
      where: { season: { projectId: project.id } },
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
        jobs.push({ jobType: "silentAssembly", label: `Episode ${episode.number} silent picture`, startedAt: episode.silentVideoGenerationStartedAt!.toISOString(), href: episodeHref, entityId: episode.id });
      }
      if (isGenerationActive(episode.finalVideoGenerationStartedAt, "finalAssembly")) {
        jobs.push({ jobType: "finalAssembly", label: `Episode ${episode.number} final render`, startedAt: episode.finalVideoGenerationStartedAt!.toISOString(), href: episodeHref, entityId: episode.id });
      }
    }
  }

  const uniqueAiJobTypes = [...new Set(jobs.map((job) => ESTIMATE_JOB_TYPE[job.jobType]))];
  const estimateEntries = await Promise.all(
    uniqueAiJobTypes.map(async (aiJobType) => [aiJobType, await getGenerationEstimate(aiJobType)] as const)
  );
  const estimateByAiJobType = new Map(estimateEntries);

  return jobs
    .map((job) => ({
      ...job,
      stage: STAGE_LABELS[job.jobType],
      etaSeconds: etaSecondsFor(estimateByAiJobType.get(ESTIMATE_JOB_TYPE[job.jobType])?.medianDurationMs ?? null, job.startedAt),
    }))
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

/** Shared with lib/read/review-queue.ts — same admin-sees-all rule as GET /api/projects. */
export function ownedProjectsWhere(user: CurrentUser) {
  return user.role === "ADMIN" ? {} : { ownerId: user.id };
}

/** Every owned project's active claims, flattened — GET /api/mobile/v1/activity's `running`. */
async function getRunningForUser(user: CurrentUser, projectId?: string): Promise<ActivityRunningItem[]> {
  const projects = await prisma.project.findMany({
    where: projectId ? { id: projectId, ...ownedProjectsWhere(user) } : ownedProjectsWhere(user),
    select: { id: true, type: true },
  });
  const perProject = await Promise.all(
    projects.map(async (p) => {
      const jobs = await getProjectRunningJobs(p);
      return jobs.map(
        (j): ActivityRunningItem => ({
          jobType: j.jobType,
          stage: j.stage,
          label: j.label,
          startedAt: j.startedAt,
          etaSeconds: j.etaSeconds,
          projectId: p.id,
          slotId: `${j.jobType}:${j.entityId}` as SlotId,
        })
      );
    })
  );
  return perProject.flat().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

// Resolves a failure's human label + retry route + slot id from its
// (jobType, entityType, entityId) — the same information the failure badges
// on web's own panels already derive, just from a fresh lookup rather than
// the page's already-loaded scene tree (this runs cross-project, so there
// is no single loaded tree to reuse).
async function describeFailure(failure: ActiveFailure): Promise<{ label: string; retryPath: string | null; slotId: SlotId | null }> {
  const id = failure.entityId;
  switch (failure.jobType) {
    case "IMAGE_GENERATION": {
      if (failure.entityType !== "SHOT" || !id) return { label: "Shot image", retryPath: null, slotId: null };
      const shot = await prisma.shot.findUnique({ where: { id }, select: { order: true, scene: { select: { order: true } } } });
      return {
        label: shot ? `Scene ${shot.scene.order} · Shot ${shot.order} image` : "Shot image",
        retryPath: `/api/shots/${id}/images/generate`,
        slotId: `shotImage:${id}`,
      };
    }
    case "VOICE": {
      if (failure.entityType === "SCENE" && id) {
        const scene = await prisma.scene.findUnique({ where: { id }, select: { order: true } });
        return { label: scene ? `Scene ${scene.order} narration` : "Narration", retryPath: `/api/scenes/${id}/narration/generate`, slotId: `narration:${id}` };
      }
      if (failure.entityType === "DIALOGUE_LINE" && id) {
        const line = await prisma.dialogueLine.findUnique({ where: { id }, select: { order: true, scene: { select: { order: true } } } });
        return {
          label: line ? `Scene ${line.scene.order} dialogue line ${line.order}` : "Dialogue audio",
          retryPath: `/api/dialogue-lines/${id}/generate`,
          slotId: `dialogueAudio:${id}`,
        };
      }
      return { label: "Voice", retryPath: null, slotId: null };
    }
    case "VIDEO_GENERATION": {
      if (failure.entityType !== "SCENE" || !id) return { label: "Video", retryPath: null, slotId: null };
      const scene = await prisma.scene.findUnique({ where: { id }, select: { order: true } });
      return { label: scene ? `Scene ${scene.order} video` : "Video", retryPath: `/api/scenes/${id}/video/generate`, slotId: `video:${id}` };
    }
    case "MUSIC_GENERATION": {
      if (failure.entityType !== "SCENE" || !id) return { label: "Music", retryPath: null, slotId: null };
      const scene = await prisma.scene.findUnique({ where: { id }, select: { order: true } });
      return { label: scene ? `Scene ${scene.order} music` : "Music", retryPath: `/api/scenes/${id}/music/generate`, slotId: `music:${id}` };
    }
    case "SFX_GENERATION": {
      if (failure.entityType !== "SCENE" || !id) return { label: "SFX", retryPath: null, slotId: null };
      const scene = await prisma.scene.findUnique({ where: { id }, select: { order: true } });
      return { label: scene ? `Scene ${scene.order} sfx` : "SFX", retryPath: `/api/scenes/${id}/sfx/generate`, slotId: `sfx:${id}` };
    }
    case "VIDEO": {
      // The two ffmpeg assembly steps: no GenerationEntityType fits them
      // (Story/Episode-level, not Scene/Shot/DialogueLine), so entityType is
      // null and the provider value is what tells silent from final — see
      // generation-events.ts's ActiveFailure comment. entityId is a Story or
      // Episode id; there is no third way to tell them apart short of
      // checking which one actually has that id.
      if (!id) return { label: "Assembly", retryPath: null, slotId: null };
      const isSilent = failure.provider === "ffmpeg-silent-assembly";
      const story = await prisma.story.findUnique({ where: { id }, select: { id: true } });
      const base = story ? `/api/stories/${id}` : `/api/episodes/${id}`;
      return {
        label: isSilent ? "Silent picture assembly" : "Final render",
        retryPath: isSilent ? `${base}/silent-video/generate` : `${base}/video/generate`,
        slotId: `${isSilent ? "silentAssembly" : "finalAssembly"}:${id}`,
      };
    }
    default:
      return { label: failure.jobType, retryPath: null, slotId: null };
  }
}

/** Every owned project's persistent failures, flattened — GET /api/mobile/v1/activity's `needsYou`. */
async function getNeedsYouForUser(user: CurrentUser, projectId?: string): Promise<ActivityFailureItem[]> {
  const projects = await prisma.project.findMany({
    where: projectId ? { id: projectId, ...ownedProjectsWhere(user) } : ownedProjectsWhere(user),
    select: { id: true },
  });
  const perProject = await Promise.all(
    projects.map(async (p) => {
      const failures = await getActiveFailures(p.id);
      return Promise.all(
        failures.map(async (f) => {
          const described = await describeFailure(f);
          const item: ActivityFailureItem = {
            jobType: f.jobType,
            entityType: f.entityType ?? "",
            entityId: f.entityId ?? "",
            provider: f.provider,
            modelId: f.modelId,
            errorMessage: f.errorMessage,
            occurredAt: f.occurredAt,
            projectId: p.id,
            label: described.label,
            retryPath: described.retryPath,
            slotId: described.slotId,
          };
          return item;
        })
      );
    })
  );
  return perProject.flat().sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

const DONE_TODAY_LABELS: Partial<Record<AiJobType, string>> = {
  IMAGE_GENERATION: "images",
  VIDEO_GENERATION: "video clips",
  VOICE: "voice takes",
  MUSIC_GENERATION: "music takes",
  SFX_GENERATION: "SFX takes",
  VIDEO: "renders",
};

/** Every owned project's successful generations in the last 24h, grouped — GET /api/mobile/v1/activity's `doneToday`. */
async function getDoneTodayForUser(user: CurrentUser, projectId?: string): Promise<ActivityDoneItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // GenerationEvent has a plain projectId string, deliberately no relation
  // to Project (see its schema comment) — so "owned by this user" has to be
  // resolved as an id list first, not filtered via a relation.
  const owned = await prisma.project.findMany({
    where: projectId ? { id: projectId, ...ownedProjectsWhere(user) } : ownedProjectsWhere(user),
    select: { id: true },
  });
  const ownedIds = owned.map((p) => p.id);
  if (ownedIds.length === 0) return [];

  const grouped = await prisma.generationEvent.groupBy({
    by: ["projectId", "jobType"],
    where: { success: true, createdAt: { gte: since }, projectId: { in: ownedIds } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return grouped
    .map(
      (g): ActivityDoneItem => ({
        jobType: g.jobType,
        label: `${g._count._all} ${DONE_TODAY_LABELS[g.jobType] ?? g.jobType.toLowerCase()}`,
        count: g._count._all,
        at: (g._max.createdAt ?? since).toISOString(),
        projectId: g.projectId,
        // Mobile-app-internal path — Review is the root tab. Client resolves
        // the `?project=` query param; see M1.4's deep-link routing.
        deepLink: `/?project=${g.projectId}`,
      })
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** GET /api/mobile/v1/activity — mobile-app-ux-plan §4.7. `projectId` narrows to one project; omitted spans everything the user owns (or everything, for an admin). */
export async function getActivityForUser(user: CurrentUser, projectId?: string): Promise<ActivityResponse> {
  const [running, needsYou, doneToday] = await Promise.all([
    getRunningForUser(user, projectId),
    getNeedsYouForUser(user, projectId),
    getDoneTodayForUser(user, projectId),
  ]);
  return { running, needsYou, doneToday };
}
