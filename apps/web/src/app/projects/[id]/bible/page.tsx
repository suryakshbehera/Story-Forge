import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";
import { getOrCreateBlueprint } from "@/lib/blueprint";
import { StoryBibleEditor } from "@/components/story-bible-editor";
import { BlueprintEditor } from "@/components/blueprint-editor";
import { DocumentIngestPanel } from "@/components/document-ingest-panel";
import { StyleAnchorCard } from "@/components/style-anchor-card";

export default async function StoryBiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      storyBible: true,
      styleReferences: true,
      sourceDocuments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) notFound();
  if (project.type !== "SERIES" || !project.storyBible) redirect(`/projects/${id}/story`);

  const [bibleVersions, blueprint] = await Promise.all([
    listVersions("STORY_BIBLE", project.storyBible.id),
    getOrCreateBlueprint(id),
  ]);
  const blueprintVersions = await listVersions("SERIES_BLUEPRINT", blueprint.id);

  return (
    <div className="flex flex-col gap-4">
      <DocumentIngestPanel
        projectId={id}
        initialSourceDocuments={project.sourceDocuments.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          storageKey: d.storageKey,
          createdAt: d.createdAt.toISOString(),
        }))}
      />

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
        initialVersions={bibleVersions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          isSelected: v.isSelected,
          createdBy: v.createdBy,
          modelId: v.modelId,
          createdAt: v.createdAt.toISOString(),
        }))}
      />

      <BlueprintEditor
        projectId={id}
        initialFields={{
          actStructure: blueprint.actStructure ?? "",
          sceneShotGuidance: blueprint.sceneShotGuidance ?? "",
          runtimeTarget: blueprint.runtimeTarget ?? "",
          tone: blueprint.tone ?? "",
        }}
        initialContent={blueprint.content ?? ""}
        initialVersions={blueprintVersions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          isSelected: v.isSelected,
          createdBy: v.createdBy,
          modelId: v.modelId,
          createdAt: v.createdAt.toISOString(),
        }))}
      />

      <StyleAnchorCard projectId={id} initialImages={project.styleReferences} />
    </div>
  );
}
