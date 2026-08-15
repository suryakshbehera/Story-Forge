import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapScenesImages } from "@/lib/scenes";
import { mapSceneVoiceData } from "@/lib/voice";
import { mapSceneVideoData } from "@/lib/scene-video";
import { mapSceneAudioData } from "@/lib/scene-audio";
import { mapFinalVideos } from "@/lib/video-assembly";
import { SceneManager } from "@/components/scene-manager";
import { VideoAssemblyPanel } from "@/components/video-assembly-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export default async function StoryScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/story`);

  const [scenes, characters, locations, story] = await Promise.all([
    prisma.scene.findMany({
      where: { storyId: project.story.id },
      orderBy: { order: "asc" },
      include: { ...SCENE_INCLUDE, ...VOICE_INCLUDE, ...VIDEO_INCLUDE, ...AUDIO_INCLUDE },
    }),
    prisma.character.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.story.findUniqueOrThrow({
      where: { id: project.story.id },
      include: { finalVideos: { orderBy: { createdAt: "desc" } } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <SceneManager
        parentType="story"
        parentId={project.story.id}
        projectId={id}
        initialScenes={mapScenesImages(scenes).map(mapSceneVoiceData).map(mapSceneVideoData).map(mapSceneAudioData)}
        characters={characters}
        locations={locations}
        initialNarratorVoiceName={project.narratorVoiceName}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final Assembly</CardTitle>
        </CardHeader>
        <CardContent>
          <VideoAssemblyPanel
            parentType="story"
            parentId={project.story.id}
            initialFinalVideos={mapFinalVideos(story).finalVideos}
          />
        </CardContent>
      </Card>
    </div>
  );
}
