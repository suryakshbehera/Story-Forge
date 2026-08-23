import { notFound } from "next/navigation";
import { prisma, type Prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapScenesShots } from "@/lib/scenes";
import { mapSceneVideoData } from "@/lib/scene-video";
import { storage } from "@/lib/storage";
import { SeedanceStudio, type SeedanceSceneOption } from "@/components/seedance-studio";

// Overrides SCENE_INCLUDE's minimal {id,name} characters/locations select
// with each entity's isLocked flag (characters only) and first reference
// image — the same "generation-time reference" data generateSceneVideo's
// includeCastReferences option resolves server-side (see lib/scene-video.ts)
// — surfaced here so the Studio page can show the user what would be sent.
const sceneInclude = {
  ...SCENE_INCLUDE,
  characters: {
    select: {
      id: true,
      name: true,
      isLocked: true,
      referenceImages: { orderBy: { createdAt: "asc" as const }, take: 1, select: { id: true, storageKey: true } },
    },
  },
  locations: {
    select: {
      id: true,
      name: true,
      referenceImages: { orderBy: { createdAt: "asc" as const }, take: 1, select: { id: true, storageKey: true } },
    },
  },
  videoClips: { orderBy: { createdAt: "desc" as const } },
  episode: { select: { number: true, season: { select: { number: true } } } },
} satisfies Prisma.SceneInclude;

export default async function SeedancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();

  // Scenes live under Story (SINGLE) or under Episode->Season (SERIES) — see
  // Scene.storyId/episodeId in schema.prisma. This page is scoped to the
  // whole project either way, so it queries across both shapes rather than
  // requiring a specific story/episode route, unlike every other scene UI.
  const rawScenes =
    project.type === "SINGLE"
      ? project.story
        ? await prisma.scene.findMany({
            where: { storyId: project.story.id, visualMode: { in: ["IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"] } },
            orderBy: { order: "asc" },
            include: sceneInclude,
          })
        : []
      : await prisma.scene.findMany({
          where: {
            visualMode: { in: ["IMAGE_TO_VIDEO", "TEXT_TO_VIDEO"] },
            episode: { season: { projectId: id } },
          },
          orderBy: [{ episode: { season: { number: "asc" } } }, { episode: { number: "asc" } }, { order: "asc" }],
          include: sceneInclude,
        });

  // rawScenes is already filtered to visualMode IN (IMAGE_TO_VIDEO, TEXT_TO_VIDEO)
  // above; Prisma's type can't reflect that narrowing, hence the cast.
  const scenes = mapScenesShots(rawScenes)
    .map(mapSceneVideoData)
    .map((scene) => ({
      ...scene,
      groupLabel: scene.episode ? `S${scene.episode.season.number}E${scene.episode.number}` : null,
      castReferences: {
        characters: scene.characters.map((c) => ({
          id: c.id,
          name: c.name,
          isLocked: c.isLocked,
          imageUrl: c.referenceImages[0] ? storage.url(c.referenceImages[0].storageKey) : null,
        })),
        locations: scene.locations.map((l) => ({
          id: l.id,
          name: l.name,
          imageUrl: l.referenceImages[0] ? storage.url(l.referenceImages[0].storageKey) : null,
        })),
      },
    })) as SeedanceSceneOption[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Seedance 2.5 Studio</h2>
        <p className="text-sm text-muted-foreground">
          A director-style prompt builder tuned to Seedance 2.5&apos;s subject/action/camera/style structure,
          timed beats, and explicit endings. Generates through the same Video Generation pipeline as every
          other model — add a row in{" "}
          <a href="/settings/ai-models" className="underline">
            Settings → AI Models
          </a>{" "}
          once (confirmed via OpenRouter: model id <code>bytedance/seedance-2.5</code>, durations 4–30s, resolutions
          480p/720p, native audio supported — e.g. config{" "}
          <code>{`{"durationMode":"range","minDurationSeconds":4,"maxDurationSeconds":30,"resolutions":["720p","480p"],"supportsNativeAudio":true}`}</code>
          ), then pick it below.
        </p>
      </div>
      <SeedanceStudio scenes={scenes} />
    </div>
  );
}
