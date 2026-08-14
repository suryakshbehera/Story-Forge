import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapScenesImages } from "@/lib/scenes";
import { mapSceneVoiceData } from "@/lib/voice";
import { SceneManager } from "@/components/scene-manager";

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

export default async function StoryScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/story`);

  const [scenes, characters, locations] = await Promise.all([
    prisma.scene.findMany({
      where: { storyId: project.story.id },
      orderBy: { order: "asc" },
      include: { ...SCENE_INCLUDE, ...VOICE_INCLUDE },
    }),
    prisma.character.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <SceneManager
      parentType="story"
      parentId={project.story.id}
      projectId={id}
      initialScenes={mapScenesImages(scenes).map(mapSceneVoiceData)}
      characters={characters}
      locations={locations}
      initialNarratorVoiceName={project.narratorVoiceName}
    />
  );
}
