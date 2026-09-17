import type { ReviewResponse, ReviewSlot, ReviewTake, SlotKind, SceneVisualMode } from "contract";
import { prisma } from "@/lib/db";
import { ESTIMATE_JOB_TYPE } from "@/lib/generation-claims";
import { groupIntoTakes } from "@/lib/video-takes";
import type { CurrentUser } from "@/lib/auth";
import { mediaRef } from "./media";
import { ownedProjectsWhere } from "./activity";

// GET /api/mobile/v1/review — the core mobile screen (mobile-app-ux-plan
// §4.2), and the item the technical plan calls "the hard one" (§8, B5).
// Queue membership and ordering exactly as specified in
// mobile-technical-plan-2026-09.md §1.5: a slot is waiting iff its
// currently-selected take (language = null) has reviewedAt IS NULL;
// ordering is project.updatedAt desc -> scene.order asc -> shot.order asc
// -> kind rank. The queue is finite and typically tens of items (per that
// spec), so this fetches every candidate slot per kind in one query each,
// then sorts/paginates in memory rather than trying to do cross-kind
// pagination at the database layer.

const KIND_RANK: Record<SlotKind, number> = {
  shotImage: 0,
  video: 1,
  narration: 2,
  dialogueAudio: 3,
  music: 4,
  sfx: 5,
  silentAssembly: 6,
  finalAssembly: 7,
};

const VISUAL_MODE_LABEL: Record<SceneVisualMode, string> = {
  ILLUSTRATION: "Illustration",
  IMAGE_TO_VIDEO: "Image-to-Video",
  TEXT_TO_VIDEO: "Text-to-Video",
};

const takeSelect = {
  id: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  metadata: true,
  isSelected: true,
  keptAt: true,
  createdAt: true,
  createdBy: true,
  modelId: true,
  validationPassed: true,
  validationNotes: true,
  qcPassed: true,
  qcNotes: true,
  reviewedAt: true,
} as const;

type TakeRow = {
  id: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: unknown;
  isSelected: boolean;
  keptAt: Date | null;
  createdAt: Date;
  createdBy: "USER" | "AI";
  modelId: string | null;
  validationPassed: boolean | null;
  validationNotes: string | null;
  qcPassed: boolean | null;
  qcNotes: string | null;
  reviewedAt: Date | null;
};

function toReviewTake(asset: TakeRow, clips: ReviewTake["clips"] = null): ReviewTake {
  return {
    id: asset.id,
    media: mediaRef(asset)!,
    isSelected: asset.isSelected,
    keptAt: asset.keptAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    createdBy: asset.createdBy,
    modelId: asset.modelId,
    validationPassed: asset.validationPassed,
    validationNotes: asset.validationNotes,
    qcPassed: asset.qcPassed,
    qcNotes: asset.qcNotes,
    clips,
  };
}

interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: Date;
}

function sceneOwnedFilter(projectIds: string[]) {
  return {
    OR: [{ story: { projectId: { in: projectIds } } }, { episode: { season: { projectId: { in: projectIds } } } }],
  };
}

const sceneContextSelect = {
  id: true,
  order: true,
  title: true,
  visualMode: true,
  story: { select: { projectId: true } },
  episode: { select: { season: { select: { projectId: true } } } },
} as const;

type SceneContextRow = {
  id: string;
  order: number;
  title: string | null;
  visualMode: SceneVisualMode;
  story: { projectId: string } | null;
  episode: { season: { projectId: string } } | null;
};

function sceneProjectId(scene: SceneContextRow): string | null {
  return scene.story?.projectId ?? scene.episode?.season.projectId ?? null;
}

// Same-scene-only (order - 1) — deliberately simpler than the generation
// pipeline's full cross-scene continuity chase (lib/scene-continuity.ts):
// the UX spec for long-press compare (mobile-app-ux-plan §5.1) says "shot
// N-1's selected image, same scene", not the generation prompt's broader
// carry-forward rule. One extra query per waiting shot slot — acceptable at
// this queue's scale (tens of items), not a hot path.
async function previousShotImageUrl(sceneId: string, order: number): Promise<string | null> {
  if (order <= 1) return null;
  const prev = await prisma.shot.findFirst({
    where: { sceneId, order: order - 1 },
    select: { images: { where: { isSelected: true }, take: 1, select: { storageKey: true, mimeType: true, sizeBytes: true, metadata: true } } },
  });
  const image = prev?.images[0];
  return image ? mediaRef(image)!.url : null;
}

async function getShotImageSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const shots = await prisma.shot.findMany({
    where: { images: { some: { isSelected: true, reviewedAt: null } }, scene: sceneOwnedFilter(projectIds) },
    select: {
      id: true,
      order: true,
      scene: { select: { ...sceneContextSelect, _count: { select: { shots: true } } } },
      images: { orderBy: { createdAt: "desc" }, take: 8, select: takeSelect },
    },
  });

  const slots: ReviewSlot[] = [];
  for (const shot of shots) {
    const projectId = sceneProjectId(shot.scene);
    const project = projectId ? projects.get(projectId) : undefined;
    if (!project) continue;
    const selected = shot.images.find((a) => a.isSelected) ?? null;
    slots.push({
      slotId: `shotImage:${shot.id}`,
      kind: "shotImage",
      entityId: shot.id,
      media: "image",
      project: { id: project.id, name: project.name },
      context: {
        sceneId: shot.scene.id,
        sceneOrder: shot.scene.order,
        sceneTitle: shot.scene.title,
        shotOrder: shot.order,
        shotCount: shot.scene._count.shots,
        visualMode: shot.scene.visualMode,
        label: `Shot ${shot.order} of ${shot.scene._count.shots} · ${VISUAL_MODE_LABEL[shot.scene.visualMode]}`,
      },
      takes: shot.images.map((a) => toReviewTake(a)),
      selectedTakeId: selected?.id ?? null,
      reviewedAt: selected?.reviewedAt?.toISOString() ?? null,
      compare: {
        selectedUrl: selected ? mediaRef(selected)!.url : null,
        previousShotUrl: await previousShotImageUrl(shot.scene.id, shot.order),
      },
      actions: {
        selectPath: `/api/shots/${shot.id}/images/{assetId}/select`,
        retakePath: `/api/shots/${shot.id}/images/generate`,
        keepPath: `/api/mobile/v1/takes/{assetId}/keep`,
        estimateJobType: ESTIMATE_JOB_TYPE.shotImage,
      },
    });
  }
  return slots;
}

type SceneAudioKind = "narration" | "music" | "sfx";

// Three concrete query functions rather than one parameterized by kind —
// same reasoning as buildAssemblySlot below: Prisma's per-relation select
// shape differs just enough (narrationAudio scopes by language, music/sfx
// don't) that a single generic needs an unsafe cast to read the result back
// out, and getting that cast wrong is exactly the kind of bug that compiles
// fine and is wrong at runtime. Sharing buildSceneAudioSlot keeps the actual
// ReviewSlot construction from being duplicated three times.
function buildSceneAudioSlot(params: {
  kind: SceneAudioKind;
  scene: SceneContextRow;
  project: ProjectInfo;
  label: string;
  takes: TakeRow[];
  selectPath: string;
  retakePath: string;
}): ReviewSlot {
  const { kind, scene, project, label, takes, selectPath, retakePath } = params;
  const selected = takes.find((a) => a.isSelected) ?? null;
  return {
    slotId: `${kind}:${scene.id}`,
    kind,
    entityId: scene.id,
    media: "audio",
    project: { id: project.id, name: project.name },
    context: {
      sceneId: scene.id,
      sceneOrder: scene.order,
      sceneTitle: scene.title,
      shotOrder: null,
      shotCount: null,
      visualMode: scene.visualMode,
      label: `Scene ${scene.order} · ${label}`,
    },
    takes: takes.map((a) => toReviewTake(a)),
    selectedTakeId: selected?.id ?? null,
    reviewedAt: selected?.reviewedAt?.toISOString() ?? null,
    compare: { selectedUrl: null, previousShotUrl: null },
    actions: { selectPath, retakePath, keepPath: `/api/mobile/v1/takes/{assetId}/keep`, estimateJobType: ESTIMATE_JOB_TYPE[kind] },
  };
}

async function getNarrationSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const scenes = await prisma.scene.findMany({
    where: { narrationAudio: { some: { isSelected: true, reviewedAt: null, language: null } }, ...sceneOwnedFilter(projectIds) },
    select: { ...sceneContextSelect, narrationAudio: { where: { language: null }, orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
  });
  const slots: ReviewSlot[] = [];
  for (const scene of scenes) {
    const project = sceneProjectId(scene) ? projects.get(sceneProjectId(scene)!) : undefined;
    if (!project) continue;
    slots.push(
      buildSceneAudioSlot({
        kind: "narration",
        scene,
        project,
        label: "Narration",
        takes: scene.narrationAudio,
        selectPath: `/api/scenes/${scene.id}/narration/{assetId}`,
        retakePath: `/api/scenes/${scene.id}/narration/generate`,
      })
    );
  }
  return slots;
}

async function getMusicSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const scenes = await prisma.scene.findMany({
    where: { music: { some: { isSelected: true, reviewedAt: null } }, ...sceneOwnedFilter(projectIds) },
    select: { ...sceneContextSelect, music: { orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
  });
  const slots: ReviewSlot[] = [];
  for (const scene of scenes) {
    const project = sceneProjectId(scene) ? projects.get(sceneProjectId(scene)!) : undefined;
    if (!project) continue;
    slots.push(
      buildSceneAudioSlot({
        kind: "music",
        scene,
        project,
        label: "Music",
        takes: scene.music,
        selectPath: `/api/scenes/${scene.id}/music/{assetId}/select`,
        retakePath: `/api/scenes/${scene.id}/music/generate`,
      })
    );
  }
  return slots;
}

async function getSfxSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const scenes = await prisma.scene.findMany({
    where: { sfx: { some: { isSelected: true, reviewedAt: null } }, ...sceneOwnedFilter(projectIds) },
    select: { ...sceneContextSelect, sfx: { orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
  });
  const slots: ReviewSlot[] = [];
  for (const scene of scenes) {
    const project = sceneProjectId(scene) ? projects.get(sceneProjectId(scene)!) : undefined;
    if (!project) continue;
    slots.push(
      buildSceneAudioSlot({
        kind: "sfx",
        scene,
        project,
        label: "SFX",
        takes: scene.sfx,
        selectPath: `/api/scenes/${scene.id}/sfx/{assetId}/select`,
        retakePath: `/api/scenes/${scene.id}/sfx/generate`,
      })
    );
  }
  return slots;
}

async function getDialogueAudioSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const lines = await prisma.dialogueLine.findMany({
    where: { audio: { some: { isSelected: true, reviewedAt: null, language: null } }, scene: sceneOwnedFilter(projectIds) },
    select: {
      id: true,
      order: true,
      scene: { select: sceneContextSelect },
      audio: { where: { language: null }, orderBy: { createdAt: "desc" }, take: 8, select: takeSelect },
    },
  });

  const slots: ReviewSlot[] = [];
  for (const line of lines) {
    const projectId = sceneProjectId(line.scene);
    const project = projectId ? projects.get(projectId) : undefined;
    if (!project) continue;
    const selected = line.audio.find((a) => a.isSelected) ?? null;
    slots.push({
      slotId: `dialogueAudio:${line.id}`,
      kind: "dialogueAudio",
      entityId: line.id,
      media: "audio",
      project: { id: project.id, name: project.name },
      context: {
        sceneId: line.scene.id,
        sceneOrder: line.scene.order,
        sceneTitle: line.scene.title,
        shotOrder: null,
        shotCount: null,
        visualMode: line.scene.visualMode,
        label: `Scene ${line.scene.order} · Dialogue line ${line.order}`,
      },
      takes: line.audio.map((a) => toReviewTake(a)),
      selectedTakeId: selected?.id ?? null,
      reviewedAt: selected?.reviewedAt?.toISOString() ?? null,
      compare: { selectedUrl: null, previousShotUrl: null },
      actions: {
        selectPath: `/api/dialogue-lines/${line.id}/audio/{assetId}`,
        retakePath: `/api/dialogue-lines/${line.id}/generate`,
        keepPath: `/api/mobile/v1/takes/{assetId}/keep`,
        estimateJobType: ESTIMATE_JOB_TYPE.dialogueAudio,
      },
    });
  }
  return slots;
}

async function getVideoSlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const scenes = await prisma.scene.findMany({
    where: { videoClips: { some: { isSelected: true, reviewedAt: null } }, ...sceneOwnedFilter(projectIds) },
    select: {
      ...sceneContextSelect,
      // Generous cap — up to 8 takes' worth of clips, a handful of clips each.
      videoClips: { orderBy: { createdAt: "desc" }, take: 40, select: { ...takeSelect, videoBatchId: true, videoSegmentOrder: true, videoPairIndex: true } },
    },
  });

  const slots: ReviewSlot[] = [];
  for (const scene of scenes) {
    const projectId = sceneProjectId(scene);
    const project = projectId ? projects.get(projectId) : undefined;
    if (!project) continue;

    // groupIntoTakes expects oldest-first-per-batch semantics for
    // segmentOrder sorting, but batch identification itself doesn't depend
    // on overall ordering — newest-first input is fine.
    const clipRows = scene.videoClips.map((c) => ({
      id: c.id,
      url: mediaRef(c)!.url,
      isSelected: c.isSelected,
      batchId: c.videoBatchId,
      segmentOrder: c.videoSegmentOrder,
      pairIndex: c.videoPairIndex,
    }));
    const takesGrouped = groupIntoTakes(clipRows).slice(0, 8);
    const byId = new Map(scene.videoClips.map((c) => [c.id, c]));

    const reviewTakes: ReviewTake[] = takesGrouped.map((take) => {
      const representative = byId.get(take.clips[0].id)!;
      return toReviewTake(
        representative,
        take.clips.map((c) => ({ url: c.url, segmentOrder: c.segmentOrder ?? null, pairIndex: c.pairIndex ?? null }))
      );
    });
    const selectedTake = takesGrouped.find((t) => t.isSelected) ?? null;
    const selectedRepresentative = selectedTake ? byId.get(selectedTake.clips[0].id) : null;

    slots.push({
      slotId: `video:${scene.id}`,
      kind: "video",
      entityId: scene.id,
      media: "video",
      project: { id: project.id, name: project.name },
      context: {
        sceneId: scene.id,
        sceneOrder: scene.order,
        sceneTitle: scene.title,
        shotOrder: null,
        shotCount: null,
        visualMode: scene.visualMode,
        label: `Scene ${scene.order} · Video`,
      },
      takes: reviewTakes,
      selectedTakeId: selectedRepresentative?.id ?? null,
      reviewedAt: selectedRepresentative?.reviewedAt?.toISOString() ?? null,
      compare: { selectedUrl: null, previousShotUrl: null },
      actions: {
        selectPath: `/api/scenes/${scene.id}/video/{assetId}/select`,
        retakePath: `/api/scenes/${scene.id}/video/generate`,
        keepPath: `/api/mobile/v1/takes/{assetId}/keep`,
        estimateJobType: ESTIMATE_JOB_TYPE.video,
      },
    });
  }
  return slots;
}

type AssemblyKind = "silentAssembly" | "finalAssembly";

// Two concrete functions rather than one parameterized by kind: Prisma's
// `select` shape differs (finalVideos scopes by language, silentVideos
// doesn't — video has no meaningful language field), and threading that
// through a single generic produced a union type TS couldn't narrow inside
// the loop. Both share buildAssemblySlot below for the actual ReviewSlot
// construction, so there's no real duplication of logic, just of the query.
function buildAssemblySlot(params: {
  kind: AssemblyKind;
  entityId: string;
  project: ProjectInfo;
  label: string;
  takes: TakeRow[];
  parentSegment: "stories" | "episodes";
  pathSegment: "silent-video" | "video";
}): ReviewSlot {
  const { kind, entityId, project, label, takes, parentSegment, pathSegment } = params;
  const selected = takes.find((a) => a.isSelected) ?? null;
  return {
    slotId: `${kind}:${entityId}`,
    kind,
    entityId,
    media: "video",
    project: { id: project.id, name: project.name },
    context: { sceneId: null, sceneOrder: null, sceneTitle: null, shotOrder: null, shotCount: null, visualMode: null, label },
    takes: takes.map((a) => toReviewTake(a)),
    selectedTakeId: selected?.id ?? null,
    reviewedAt: selected?.reviewedAt?.toISOString() ?? null,
    compare: { selectedUrl: null, previousShotUrl: null },
    actions: {
      selectPath: `/api/${parentSegment}/${entityId}/${pathSegment}/{assetId}/select`,
      retakePath: `/api/${parentSegment}/${entityId}/${pathSegment}/generate`,
      keepPath: `/api/mobile/v1/takes/{assetId}/keep`,
      estimateJobType: ESTIMATE_JOB_TYPE[kind],
    },
  };
}

async function getSilentAssemblySlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const [stories, episodes] = await Promise.all([
    prisma.story.findMany({
      where: { projectId: { in: projectIds }, silentVideos: { some: { isSelected: true, reviewedAt: null } } },
      select: { id: true, projectId: true, silentVideos: { orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
    }),
    prisma.episode.findMany({
      where: { season: { projectId: { in: projectIds } }, silentVideos: { some: { isSelected: true, reviewedAt: null } } },
      select: { id: true, number: true, season: { select: { projectId: true } }, silentVideos: { orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
    }),
  ]);

  const slots: ReviewSlot[] = [];
  for (const story of stories) {
    const project = projects.get(story.projectId);
    if (!project) continue;
    slots.push(
      buildAssemblySlot({
        kind: "silentAssembly",
        entityId: story.id,
        project,
        label: "Silent picture assembly",
        takes: story.silentVideos,
        parentSegment: "stories",
        pathSegment: "silent-video",
      })
    );
  }
  for (const episode of episodes) {
    const project = projects.get(episode.season.projectId);
    if (!project) continue;
    slots.push(
      buildAssemblySlot({
        kind: "silentAssembly",
        entityId: episode.id,
        project,
        label: `Episode ${episode.number} silent picture`,
        takes: episode.silentVideos,
        parentSegment: "episodes",
        pathSegment: "silent-video",
      })
    );
  }
  return slots;
}

async function getFinalAssemblySlots(projectIds: string[], projects: Map<string, ProjectInfo>): Promise<ReviewSlot[]> {
  const [stories, episodes] = await Promise.all([
    prisma.story.findMany({
      where: { projectId: { in: projectIds }, finalVideos: { some: { isSelected: true, reviewedAt: null, language: null } } },
      select: { id: true, projectId: true, finalVideos: { where: { language: null }, orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
    }),
    prisma.episode.findMany({
      where: { season: { projectId: { in: projectIds } }, finalVideos: { some: { isSelected: true, reviewedAt: null, language: null } } },
      select: { id: true, number: true, season: { select: { projectId: true } }, finalVideos: { where: { language: null }, orderBy: { createdAt: "desc" }, take: 8, select: takeSelect } },
    }),
  ]);

  const slots: ReviewSlot[] = [];
  for (const story of stories) {
    const project = projects.get(story.projectId);
    if (!project) continue;
    slots.push(
      buildAssemblySlot({
        kind: "finalAssembly",
        entityId: story.id,
        project,
        label: "Final render",
        takes: story.finalVideos,
        parentSegment: "stories",
        pathSegment: "video",
      })
    );
  }
  for (const episode of episodes) {
    const project = projects.get(episode.season.projectId);
    if (!project) continue;
    slots.push(
      buildAssemblySlot({
        kind: "finalAssembly",
        entityId: episode.id,
        project,
        label: `Episode ${episode.number} final render`,
        takes: episode.finalVideos,
        parentSegment: "episodes",
        pathSegment: "video",
      })
    );
  }
  return slots;
}

function pipelineRank(slot: ReviewSlot, projectUpdatedAt: number): [number, number, number, number] {
  return [-projectUpdatedAt, slot.context.sceneOrder ?? 0, slot.context.shotOrder ?? 0, KIND_RANK[slot.kind]];
}

function compareRanks(a: [number, number, number, number], b: [number, number, number, number]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export async function getReviewQueue(
  user: CurrentUser,
  { projectId, limit = 20, offset = 0 }: { projectId?: string; limit?: number; offset?: number }
): Promise<ReviewResponse> {
  const boundedLimit = Math.min(Math.max(limit, 1), 50);

  const projectRows = await prisma.project.findMany({
    where: projectId ? { id: projectId, ...ownedProjectsWhere(user) } : ownedProjectsWhere(user),
    select: { id: true, name: true, updatedAt: true },
  });
  const projects = new Map(projectRows.map((p) => [p.id, p]));
  const projectIds = [...projects.keys()];
  if (projectIds.length === 0) {
    return { items: [], total: 0, nextOffset: null, counts: { waiting: 0, byProject: [] } };
  }

  const [shotImage, narration, music, sfx, dialogueAudio, video, silentAssembly, finalAssembly] = await Promise.all([
    getShotImageSlots(projectIds, projects),
    getNarrationSlots(projectIds, projects),
    getMusicSlots(projectIds, projects),
    getSfxSlots(projectIds, projects),
    getDialogueAudioSlots(projectIds, projects),
    getVideoSlots(projectIds, projects),
    getSilentAssemblySlots(projectIds, projects),
    getFinalAssemblySlots(projectIds, projects),
  ]);

  const all = [...shotImage, ...video, ...narration, ...dialogueAudio, ...music, ...sfx, ...silentAssembly, ...finalAssembly];

  const ranked = all
    .map((slot) => ({ slot, rank: pipelineRank(slot, projects.get(slot.project.id)!.updatedAt.getTime()) }))
    .sort((a, b) => compareRanks(a.rank, b.rank));

  const byProjectCounts = new Map<string, number>();
  for (const { slot } of ranked) {
    byProjectCounts.set(slot.project.id, (byProjectCounts.get(slot.project.id) ?? 0) + 1);
  }

  const page = ranked.slice(offset, offset + boundedLimit).map((r) => r.slot);
  const total = ranked.length;
  const nextOffset = offset + boundedLimit < total ? offset + boundedLimit : null;

  return {
    items: page,
    total,
    nextOffset,
    counts: {
      waiting: total,
      byProject: [...byProjectCounts.entries()].map(([pid, waiting]) => ({ projectId: pid, waiting })),
    },
  };
}
