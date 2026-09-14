import { prisma } from "@/lib/db";

interface SceneRef {
  order: number;
  storyId: string | null;
  episodeId: string | null;
}

// Shot.continuity is an untyped Json? column (no UI writes it yet, only
// SHOT_PLANNING) — parsed defensively rather than trusted, same posture as
// any other value crossing the AI-response boundary. Shared by shots.ts
// (SHOT_PLANNING prompt) and shot-images.ts (generation + validation).
export function parseContinuitySnapshot(value: unknown): { subject: string; state: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is { subject: string; state: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).subject === "string" &&
      typeof (entry as Record<string, unknown>).state === "string"
  );
}

// Chases the previous scene across episode/season boundaries, not just
// within one scene's own parent list — a season/episode premiere's first
// scene has a "previous scene" too (the prior episode's/season's closing
// one), the same way any other adjacent pair does.
async function findPreviousSceneId(scene: SceneRef): Promise<string | null> {
  if (scene.storyId) {
    const prev = await prisma.scene.findFirst({
      where: { storyId: scene.storyId, order: scene.order - 1 },
      select: { id: true },
    });
    return prev?.id ?? null;
  }
  if (!scene.episodeId) return null;

  const prevInEpisode = await prisma.scene.findFirst({
    where: { episodeId: scene.episodeId, order: scene.order - 1 },
    select: { id: true },
  });
  if (prevInEpisode) return prevInEpisode.id;

  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: scene.episodeId },
    select: { number: true, seasonId: true },
  });
  let prevEpisode = await prisma.episode.findFirst({
    where: { seasonId: episode.seasonId, number: episode.number - 1 },
    select: { id: true },
  });
  if (!prevEpisode) {
    const season = await prisma.season.findUniqueOrThrow({
      where: { id: episode.seasonId },
      select: { number: true, projectId: true },
    });
    const prevSeason = await prisma.season.findFirst({
      where: { projectId: season.projectId, number: season.number - 1 },
      select: { id: true },
    });
    if (!prevSeason) return null;
    prevEpisode = await prisma.episode.findFirst({
      where: { seasonId: prevSeason.id },
      orderBy: { number: "desc" },
      select: { id: true },
    });
  }
  if (!prevEpisode) return null;

  const lastScene = await prisma.scene.findFirst({
    where: { episodeId: prevEpisode.id },
    orderBy: { order: "desc" },
    select: { id: true },
  });
  return lastScene?.id ?? null;
}

// The last shot of whatever scene immediately precedes `scene` in viewing
// order (see findPreviousSceneId for the story/episode/season chain).
// Returns null for the very first scene of a project — there's nothing
// before it to carry from. Also returns the last shot's own cinematography
// fields (shotSize/cameraAngle/cameraMovement/lensMm/framing) as scalars —
// no extra query needed for Phase 2's camera carry, Prisma returns scalars
// on `findFirst` regardless of `include`.
export async function findLastShotOfPreviousScene(scene: SceneRef) {
  const prevSceneId = await findPreviousSceneId(scene);
  if (!prevSceneId) return null;
  return prisma.shot.findFirst({
    where: { sceneId: prevSceneId },
    orderBy: { order: "desc" },
    include: { images: { where: { isSelected: true }, take: 1 } },
  });
}

// The previous scene's own `closingState` (environment/actions/spatial/
// anchors/story-state — see Scene.closingState in schema.prisma) — the
// counterpart to findLastShotOfPreviousScene's character/object/camera
// state, for categories that live at the scene level rather than on a shot.
export async function findPreviousSceneClosingState(scene: SceneRef): Promise<unknown> {
  const prevSceneId = await findPreviousSceneId(scene);
  if (!prevSceneId) return null;
  const prev = await prisma.scene.findUnique({ where: { id: prevSceneId }, select: { closingState: true } });
  return prev?.closingState ?? null;
}

export interface SceneClosingState {
  environment: { location?: string; timeOfDay?: string; weather?: string; lighting?: string } | null;
  unfinishedActions: string | null;
  spatialNotes: string | null;
  continuityAnchors: { subject: string; mustNotChange: string }[];
  storyState: string | null;
}

// Scene.closingState is an untyped Json? column (same AI-response-boundary
// posture as Shot.continuity) — parsed defensively rather than trusted.
export function parseClosingState(value: unknown): SceneClosingState {
  const empty: SceneClosingState = {
    environment: null,
    unfinishedActions: null,
    spatialNotes: null,
    continuityAnchors: [],
    storyState: null,
  };
  if (typeof value !== "object" || value === null) return empty;
  const v = value as Record<string, unknown>;

  const rawEnv = typeof v.environment === "object" && v.environment !== null ? (v.environment as Record<string, unknown>) : null;
  const environment = rawEnv
    ? {
        location: typeof rawEnv.location === "string" ? rawEnv.location : undefined,
        timeOfDay: typeof rawEnv.timeOfDay === "string" ? rawEnv.timeOfDay : undefined,
        weather: typeof rawEnv.weather === "string" ? rawEnv.weather : undefined,
        lighting: typeof rawEnv.lighting === "string" ? rawEnv.lighting : undefined,
      }
    : null;

  const continuityAnchors = Array.isArray(v.continuityAnchors)
    ? v.continuityAnchors.filter(
        (e): e is { subject: string; mustNotChange: string } =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).subject === "string" &&
          typeof (e as Record<string, unknown>).mustNotChange === "string"
      )
    : [];

  return {
    environment: environment && Object.values(environment).some(Boolean) ? environment : null,
    unfinishedActions: typeof v.unfinishedActions === "string" ? v.unfinishedActions : null,
    spatialNotes: typeof v.spatialNotes === "string" ? v.spatialNotes : null,
    continuityAnchors,
    storyState: typeof v.storyState === "string" ? v.storyState : null,
  };
}

// Renders a parsed closing state into prompt-ready lines, one per category
// that actually has something to say — skips categories the model left
// empty rather than emitting a blank line for each.
export function describeClosingState(state: SceneClosingState): string[] {
  const env = state.environment;
  const envLine = env
    ? `Environment: ${[env.location, env.timeOfDay, env.weather, env.lighting].filter(Boolean).join(", ")}`
    : null;
  return [
    envLine,
    state.unfinishedActions && `Unfinished action: ${state.unfinishedActions}`,
    state.spatialNotes && `Spatial layout: ${state.spatialNotes}`,
    state.continuityAnchors.length > 0 &&
      `Must not change: ${state.continuityAnchors.map((a) => `${a.subject} — ${a.mustNotChange}`).join("; ")}`,
    state.storyState && `Story state: ${state.storyState}`,
  ].filter((v): v is string => Boolean(v));
}
