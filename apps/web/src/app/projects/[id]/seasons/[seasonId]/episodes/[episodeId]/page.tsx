import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { assembleContext } from "@/lib/context/assemble";
import { EpisodeEditor } from "@/components/episode-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
}) {
  const { id: projectId, seasonId, episodeId } = await params;
  const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
  if (!episode || episode.seasonId !== seasonId) notFound();

  const context = await assembleContext({ projectId, episodeId });

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
    </div>
  );
}
