import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";
import { StoryBibleEditor } from "@/components/story-bible-editor";

export default async function StoryBiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { storyBible: true } });
  if (!project) notFound();
  if (project.type !== "SERIES" || !project.storyBible) redirect(`/projects/${id}/story`);

  const versions = await listVersions("STORY_BIBLE", project.storyBible.id);

  return (
    <StoryBibleEditor
      projectId={id}
      initialFields={{
        premise: project.storyBible.premise ?? "",
        genre: project.storyBible.genre ?? "",
        tone: project.storyBible.tone ?? "",
        language: project.storyBible.language ?? "",
        worldRules: project.storyBible.worldRules ?? "",
        visualStyle: project.storyBible.visualStyle ?? "",
        timelineNotes: project.storyBible.timelineNotes ?? "",
      }}
      initialContent={project.storyBible.content ?? ""}
      initialVersions={versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        isSelected: v.isSelected,
        createdBy: v.createdBy,
        modelId: v.modelId,
        createdAt: v.createdAt.toISOString(),
      }))}
    />
  );
}
