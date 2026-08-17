import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { listVersions } from "@/lib/versioning";
import { StoryEditor } from "@/components/story-editor";
import { DocumentIngestPanel } from "@/components/document-ingest-panel";
import { StyleAnchorCard } from "@/components/style-anchor-card";
import { StoryChatPanel } from "@/components/story-chat-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      story: true,
      styleReferences: true,
      sourceDocuments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) notFound();
  if (project.type !== "SINGLE" || !project.story) redirect(`/projects/${id}/bible`);

  const versions = await listVersions("STORY", project.story.id);

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
      <StyleAnchorCard projectId={id} initialImages={project.styleReferences} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Story Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <StoryChatPanel
            projectId={id}
            applyTarget={{ kind: "story", projectId: id }}
            applyLabel="Story"
            initialContent={project.story.content ?? ""}
          />
        </CardContent>
      </Card>
    </div>
  );
}
