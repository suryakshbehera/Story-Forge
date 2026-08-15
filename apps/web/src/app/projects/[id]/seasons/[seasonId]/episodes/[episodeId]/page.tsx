import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { assembleContext } from "@/lib/context/assemble";
import { SCENE_INCLUDE, mapScenesImages } from "@/lib/scenes";
import { mapSceneVoiceData } from "@/lib/voice";
import { mapSceneVideoData } from "@/lib/scene-video";
import { mapSceneAudioData } from "@/lib/scene-audio";
import { mapFinalVideos } from "@/lib/video-assembly";
import { EpisodeEditor } from "@/components/episode-editor";
import { SceneManager } from "@/components/scene-manager";
import { VideoAssemblyPanel } from "@/components/video-assembly-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const VOICE_INCLUDE = {
  narrationAudio: { orderBy: { createdAt: "desc" as const } },
  dialogueLines: {
    orderBy: { order: "asc" as const },
    include: {
      character: { select: { id: true, name: true, voiceName: true } },
      audio: { orderBy: { createdAt: "desc" as const } },
    },
  },
};

const VIDEO_INCLUDE = {
  videoClips: { orderBy: { createdAt: "desc" as const } },
};

const AUDIO_INCLUDE = {
  music: { orderBy: { createdAt: "desc" as const } },
  sfx: { orderBy: { createdAt: "desc" as const } },
};

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
}) {
  const { id: projectId, seasonId, episodeId } = await params;
  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
  if (!episode || episode.seasonId !== seasonId) notFound();

  const [project, context, scenes, characters, locations, episodeVideo] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    assembleContext({ projectId, episodeId }),
    prisma.scene.findMany({
      where: { episodeId },
      orderBy: { order: "asc" },
      include: { ...SCENE_INCLUDE, ...VOICE_INCLUDE, ...VIDEO_INCLUDE, ...AUDIO_INCLUDE },
    }),
    prisma.character.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { finalVideos: { orderBy: { createdAt: "desc" } } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/projects/${projectId}/seasons`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All seasons
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Episode</CardTitle>
          </CardHeader>
          <CardContent>
            <EpisodeEditor
              episodeId={episode.id}
              initialNumber={episode.number}
              initialTitle={episode.title ?? ""}
              initialSummary={episode.summary ?? ""}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Context Engine Preview</CardTitle>
            <p className="text-xs text-muted-foreground">
              Exactly what gets sent as Project Context for generation actions scoped to this episode —
              Story Bible, locked characters, locations, and prior episode summaries only.
            </p>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {context}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenes</CardTitle>
        </CardHeader>
        <CardContent>
          <SceneManager
            parentType="episode"
            parentId={episode.id}
            projectId={projectId}
            initialScenes={mapScenesImages(scenes).map(mapSceneVoiceData).map(mapSceneVideoData).map(mapSceneAudioData)}
            characters={characters}
            locations={locations}
            initialNarratorVoiceName={project.narratorVoiceName}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final Assembly</CardTitle>
        </CardHeader>
        <CardContent>
          <VideoAssemblyPanel
            parentType="episode"
            parentId={episodeId}
            initialFinalVideos={mapFinalVideos(episodeVideo).finalVideos}
          />
        </CardContent>
      </Card>
    </div>
  );
}
