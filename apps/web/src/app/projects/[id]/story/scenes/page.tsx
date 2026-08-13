import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SCENE_INCLUDE, mapScenesImages } from "@/lib/scenes";
import { SceneManager } from "@/components/scene-manager";

export default async function StoryScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/story`);

  const [scenes, characters, locations] = await Promise.all([
    prisma.scene.findMany({
      where: { storyId: project.story.id },
      orderBy: { order: "asc" },
      include: SCENE_INCLUDE,
    }),
    prisma.character.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { projectId: id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <SceneManager
      parentType="story"
      parentId={project.story.id}
      initialScenes={mapScenesImages(scenes)}
      characters={characters}
      locations={locations}
    />
  );
}
