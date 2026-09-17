import type { ProjectDetail } from "contract";
import { prisma } from "@/lib/db";
import { getProjectStatus } from "@/lib/project-status";
import { mediaRef } from "./media";
import { projectSelect, tallyProject, headlineFor, type RawProject } from "./project-summaries";

// GET /api/mobile/v1/projects/:id — mobile-app-ux-plan §4.5. `progress`
// deliberately reuses lib/project-status.ts's getProjectStatus() as-is
// (mobile-technical-plan-2026-09.md §1.5: "getProjectStatus() stays as-is
// and remains what the detail screen uses") rather than recomputing it, so
// web and mobile can never show two different numbers for the same
// project. Only the NEW mobile-only fields — waiting/running counts, the
// hero render, renders count, nextStep — are computed here.
//
// No ownerId filter beyond what proxy.ts already enforced: by the time this
// runs, proxy's RESOLVERS entry for /api/mobile/v1/projects/:id has already
// 403'd a non-owner and already let an ADMIN through with no ownership
// check at all — re-filtering by ownerId here would wrongly 404 an admin.
export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, type: true },
  });
  if (!project) return null;

  const [status, tally, hero, rendersCount] = await Promise.all([
    getProjectStatus(project.id, project.type),
    getTally(project.id),
    getHero(project.id),
    getRendersCount(project.id),
  ]);

  const progress = {
    storyDone: status.storyDone,
    characters: status.characters,
    locations: status.locations,
    scenes: status.scenes,
    shots: status.shots,
    voice: status.voice,
    finalRenderCount: status.finalRenderCount,
    headline: headlineFor(status),
  };

  const nextStep =
    tally.waitingCount > 0
      ? { label: `Review ${tally.waitingCount} take${tally.waitingCount === 1 ? "" : "s"}`, kind: "review" as const }
      : { label: progress.headline, kind: "web" as const };

  return {
    id: project.id,
    name: project.name,
    type: project.type,
    progress,
    hero,
    waitingCount: tally.waitingCount,
    runningCount: tally.runningCount,
    rendersCount,
    nextStep,
    webHref: `/projects/${project.id}`,
  };
}

// Re-runs the SAME nested query project-summaries.ts uses for the list, but
// scoped to just this one project via `where: { id }` — cheap for a single
// project (same order of magnitude as getProjectStatus's own ~10 queries),
// and reuses tallyProject() so waiting/running can never diverge between the
// list and detail endpoints.
async function getTally(projectId: string): Promise<{ waitingCount: number; runningCount: number }> {
  const project: RawProject | null = await prisma.project.findUnique({
    where: { id: projectId },
    select: projectSelect,
  });
  if (!project) return { waitingCount: 0, runningCount: 0 };
  return tallyProject(project);
}

// hero = newest isSelected FINAL_VIDEO (primary language only), else newest
// isSelected SILENT_VIDEO, else null — mobile-technical-plan-2026-09.md
// §1.5. Works identically for SINGLE (one Story) and SERIES (many
// Episodes): the OR spans every episode, so "newest across the whole
// project" doesn't need per-episode enumeration.
async function getHero(projectId: string): Promise<ProjectDetail["hero"]> {
  const final = await prisma.asset.findFirst({
    where: {
      type: "FINAL_VIDEO",
      isSelected: true,
      language: null,
      OR: [{ storyVideo: { projectId } }, { episodeVideo: { season: { projectId } } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, metadata: true, createdAt: true },
  });
  if (final) {
    return { assetId: final.id, kind: "finalAssembly", media: mediaRef(final)!, renderedAt: final.createdAt.toISOString() };
  }

  const silent = await prisma.asset.findFirst({
    where: {
      type: "SILENT_VIDEO",
      isSelected: true,
      OR: [{ storySilentVideo: { projectId } }, { episodeSilentVideo: { season: { projectId } } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, metadata: true, createdAt: true },
  });
  if (!silent) return null;
  return { assetId: silent.id, kind: "silentAssembly", media: mediaRef(silent)!, renderedAt: silent.createdAt.toISOString() };
}

// Every render (final + silent), any take, not just the selected one — the
// Renders shelf (mobile-app-ux-plan §4.6) lists take history, this is just
// its badge count.
async function getRendersCount(projectId: string): Promise<number> {
  return prisma.asset.count({
    where: {
      type: { in: ["FINAL_VIDEO", "SILENT_VIDEO"] },
      language: null,
      OR: [
        { storyVideo: { projectId } },
        { episodeVideo: { season: { projectId } } },
        { storySilentVideo: { projectId } },
        { episodeSilentVideo: { season: { projectId } } },
      ],
    },
  });
}
