import { prisma, type AiJobType, type GenerationEntityType } from "@/lib/db";
import type { ScenesParentType } from "@/lib/scenes";
import { notifyGenerationFinished } from "@/lib/notify";

// A Scene's project is reached via Story or Episode→Season — resolving it
// here (rather than accepting a projectId from the client) is what makes
// narratorVoiceName authoritative (see voice.ts) and, now, what lets every
// metered job type attribute its cost to the right project without each
// caller re-deriving this traversal. Relocated from voice.ts (was private
// there) so scene-video.ts and scene-audio.ts can share it.
export async function resolveSceneProjectId(sceneId: string): Promise<string> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { story: true, episode: { include: { season: true } } },
  });
  const projectId = scene.story?.projectId ?? scene.episode?.season.projectId;
  if (!projectId) throw new Error(`Scene ${sceneId} has neither a story nor an episode parent.`);
  return projectId;
}

// Same idea as resolveSceneProjectId above, but for the two assembly steps
// (lib/video-assembly.ts), whose parent is a Story or Episode directly
// rather than a Scene.
export async function resolveParentProjectId(parentType: ScenesParentType, parentId: string): Promise<string> {
  if (parentType === "story") {
    const story = await prisma.story.findUniqueOrThrow({ where: { id: parentId }, select: { projectId: true } });
    return story.projectId;
  }
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: parentId },
    select: { season: { select: { projectId: true } } },
  });
  return episode.season.projectId;
}

export interface RecordGenerationEventInput {
  jobType: AiJobType;
  provider: string;
  modelId?: string | null;
  projectId: string;
  entityType?: GenerationEntityType;
  entityId?: string;
  costUsd?: number | null;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

// Cost/reliability telemetry for the metered job types (IMAGE_GENERATION,
// VIDEO_GENERATION, VOICE, MUSIC_GENERATION, SFX_GENERATION) plus VIDEO (the
// two local-ffmpeg assembly steps — always costUsd: null since there's no
// paid API call, but durationMs is real and worth recording for the same
// pre-flight-estimate reason) — see GenerationEvent in schema.prisma.
// Deliberately swallows its own failures: this is the one place in the
// codebase where an error is intentionally never rethrown, because a
// telemetry write failing must never surface as a broken generation for the
// user. Call it right after (or instead of, on failure) the provider call
// it's measuring, from the job-specific function that already owns the
// entity id — not from a shared provider dispatcher.
export async function recordGenerationEvent(input: RecordGenerationEventInput): Promise<void> {
  try {
    await prisma.generationEvent.create({
      data: {
        jobType: input.jobType,
        provider: input.provider,
        modelId: input.modelId ?? null,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        costUsd: input.costUsd ?? null,
        durationMs: input.durationMs,
        success: input.success,
        errorMessage: input.errorMessage,
      },
    });
  } catch {
    // Telemetry only — never let a logging failure break generation.
  }
  // Mobile push (M1.2) — fire-and-forget, never awaited, never throws. Hung
  // off this terminal-state write rather than the release*() claim-release
  // path: release*() knows only an entity id, not success/failure or the
  // project, and this call already has every field a notification needs.
  // See docs/product/mobile-technical-plan-2026-09.md §4.
  notifyGenerationFinished(input);
}

export interface GenerationEstimate {
  medianCostUsd: number | null;
  medianDurationMs: number | null;
  sampleSize: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ESTIMATE_SAMPLE_SIZE = 20;
// Below this many model-specific samples, a per-model median would be
// noise — fall back to the jobType-wide median instead of a near-single-data-
// point number that looks more precise than it is.
const MIN_MODEL_SPECIFIC_SAMPLES = 3;

// Observed cost/duration for the pre-flight panels (audit 2.4 /
// competitor-ux-research 4.1) — deliberately global across all projects, not
// scoped to the requesting one: a single project rarely has enough of its
// own generation history for a stable median, especially early on. Prefers a
// model-specific median (cost/duration vary a lot by model — see
// narrata-monetization-baseline) but falls back to a jobType-wide one once
// there aren't enough samples for the requested model.
export async function getGenerationEstimate(jobType: AiJobType, modelId?: string | null): Promise<GenerationEstimate> {
  let events = modelId
    ? await prisma.generationEvent.findMany({
        where: { jobType, modelId, success: true },
        orderBy: { createdAt: "desc" },
        take: ESTIMATE_SAMPLE_SIZE,
        select: { costUsd: true, durationMs: true },
      })
    : [];
  if (events.length < MIN_MODEL_SPECIFIC_SAMPLES) {
    events = await prisma.generationEvent.findMany({
      where: { jobType, success: true },
      orderBy: { createdAt: "desc" },
      take: ESTIMATE_SAMPLE_SIZE,
      select: { costUsd: true, durationMs: true },
    });
  }
  const costs = events.map((e) => e.costUsd).filter((c): c is number => c != null);
  return {
    medianCostUsd: median(costs),
    medianDurationMs: median(events.map((e) => e.durationMs)),
    sampleSize: events.length,
  };
}

export interface ActiveFailure {
  jobType: AiJobType;
  entityType: GenerationEntityType | null;
  entityId: string | null;
  provider: string;
  modelId: string | null;
  errorMessage: string | null;
  occurredAt: string;
}

// audit 2.2's stated gap: "nothing persists a failed attempt once its toast
// dismisses." A failure is durable data (it's already sitting in
// GenerationEvent) and static until the next attempt for that same slot, so
// this is a one-shot read at page-render time, not something the job tray
// needs to poll. "Active" means: the most recent event for a given slot is a
// failure, i.e. no later success has superseded it yet.
//
// A slot is identified by (entityType, entityId) for every metered job
// (IMAGE_GENERATION/VOICE/MUSIC_GENERATION/SFX_GENERATION/VIDEO_GENERATION —
// one shot/scene/dialogue line only ever has one thing generating into it,
// regardless of which provider ran). The two VIDEO assembly steps have no
// GenerationEntityType that fits (they're Story/Episode-level, not
// Scene/Shot/DialogueLine) — see the provider values recordGenerationEvent's
// callers in lib/video-assembly.ts now use ("ffmpeg-silent-assembly" /
// "ffmpeg-final-assembly") — so for those, provider+entityId is the slot key
// instead.
const FAILURE_WINDOW_SIZE = 100;

function slotKey(event: Pick<ActiveFailure, "jobType" | "entityType" | "entityId" | "provider">): string {
  return event.entityType
    ? `${event.jobType}|${event.entityType}|${event.entityId}`
    : `${event.jobType}|${event.provider}|${event.entityId}`;
}

export async function getActiveFailures(projectId: string): Promise<ActiveFailure[]> {
  const events = await prisma.generationEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: FAILURE_WINDOW_SIZE,
    select: {
      jobType: true,
      entityType: true,
      entityId: true,
      provider: true,
      modelId: true,
      errorMessage: true,
      success: true,
      createdAt: true,
    },
  });

  // events is newest-first, so the first time a slot key is seen is that
  // slot's latest event — record it and skip every older one for the same
  // slot, exactly the "superseded by a later success" rule above.
  const latestBySlot = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = slotKey(event);
    if (!latestBySlot.has(key)) latestBySlot.set(key, event);
  }

  return [...latestBySlot.values()]
    .filter((event) => !event.success)
    .map((event) => ({
      jobType: event.jobType,
      entityType: event.entityType,
      entityId: event.entityId,
      provider: event.provider,
      modelId: event.modelId,
      errorMessage: event.errorMessage,
      occurredAt: event.createdAt.toISOString(),
    }));
}

// Structurally matches components/generation-error.tsx's GenerationErrorInfo
// ({message, modelId?, provider?}) without importing that client component
// file from this server-only lib — callers (page.tsx Server Components)
// assign the result straight into an `initial*Error` prop typed as
// GenerationErrorInfo | null.
export function toErrorInfo(failure: ActiveFailure | undefined | null): { message: string; modelId?: string; provider?: string } | null {
  if (!failure) return null;
  return {
    message: failure.errorMessage ?? "Generation failed",
    modelId: failure.modelId ?? undefined,
    provider: failure.provider,
  };
}

// Keyed by entityId, for the four metered job types that seed a plain
// per-shot/per-scene/per-dialogue-line error prop.
export function failuresByEntity(
  failures: ActiveFailure[],
  jobType: AiJobType,
  entityType: GenerationEntityType
): Map<string, ActiveFailure> {
  const map = new Map<string, ActiveFailure>();
  for (const failure of failures) {
    if (failure.jobType === jobType && failure.entityType === entityType && failure.entityId) {
      map.set(failure.entityId, failure);
    }
  }
  return map;
}

// VIDEO_GENERATION is recorded at two different granularities depending on
// scene.visualMode (see lib/scene-video.ts): TEXT_TO_VIDEO logs each segment
// under entityType SCENE/sceneId, but IMAGE_TO_VIDEO logs each shot-pair
// under entityType SHOT/startShot.id (the per-pair retake needs that
// granularity). scene-video-panel.tsx only has one whole-panel lastError,
// not a per-pair one, so this looks under both and returns whichever
// failure is most recent — same all-in-one-banner behavior the panel's own
// live error handling already has.
export function sceneVideoFailure(failures: ActiveFailure[], sceneId: string, shotIds: string[]): ActiveFailure | null {
  const candidates = failures.filter(
    (failure) =>
      failure.jobType === "VIDEO_GENERATION" &&
      ((failure.entityType === "SCENE" && failure.entityId === sceneId) ||
        (failure.entityType === "SHOT" && failure.entityId != null && shotIds.includes(failure.entityId)))
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.occurredAt > latest.occurredAt ? candidate : latest));
}

// The two VIDEO assembly steps have no GenerationEntityType — see
// getActiveFailures' comment — so they're looked up by provider+parentId
// instead of entityId alone.
export interface ProjectSpend {
  totalUsd: number;
  byJobType: { jobType: AiJobType; totalUsd: number }[];
}

// Project overview's "spend to date" (competitor-ux-research 4.4) — a
// straight sum of GenerationEvent.costUsd for this project, grouped by
// jobType. costUsd is null on every failure-branch recordGenerationEvent
// call (see this file's callers), so a failed attempt contributes 0 here,
// not an error.
export async function getProjectSpend(projectId: string): Promise<ProjectSpend> {
  const grouped = await prisma.generationEvent.groupBy({
    by: ["jobType"],
    where: { projectId },
    _sum: { costUsd: true },
  });
  const byJobType = grouped
    .map((group) => ({ jobType: group.jobType, totalUsd: group._sum.costUsd ?? 0 }))
    .filter((group) => group.totalUsd > 0)
    .sort((a, b) => b.totalUsd - a.totalUsd);
  const totalUsd = byJobType.reduce((sum, group) => sum + group.totalUsd, 0);
  return { totalUsd, byJobType };
}

export function assemblyFailure(
  failures: ActiveFailure[],
  provider: "ffmpeg-silent-assembly" | "ffmpeg-final-assembly",
  parentId: string
): ActiveFailure | null {
  return failures.find((failure) => failure.jobType === "VIDEO" && failure.provider === provider && failure.entityId === parentId) ?? null;
}
