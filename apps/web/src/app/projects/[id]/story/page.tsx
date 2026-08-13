import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";
import { StoryEditor } from "@/components/story-editor";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { story: true } });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/bible`);

  const versions = await listVersions("STORY", project.story.id);

  return (
    <StoryEditor
      projectId={id}
      initialFields={{
        topic: project.story.topic ?? "",
        premise: project.story.premise ?? "",
        genre: project.story.genre ?? "",
        tone: project.story.tone ?? "",
        language: project.story.language ?? "",
        duration: project.story.duration ?? "",
        narrationStyle: project.story.narrationStyle ?? "",
        openingStyle: project.story.openingStyle ?? "",
        closingStyle: project.story.closingStyle ?? "",
      }}
      initialContent={project.story.content ?? ""}
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
