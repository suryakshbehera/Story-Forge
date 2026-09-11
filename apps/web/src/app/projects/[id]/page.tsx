import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getProjectStatus } from "@/lib/project-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";

function StatusRow({
  label,
  detail,
  done,
  href,
}: {
  label: string;
  detail: string;
  done: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm hover:bg-muted/50"
    >
      <span className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground" />
        )}
        {label}
      </span>
      <span className="text-muted-foreground">{detail}</span>
    </Link>
  );
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  const status = await getProjectStatus(id, project.type);
  const allDone =
    status.storyDone &&
    status.scenes.total > 0 &&
    status.shots.withImage === status.shots.total &&
    (status.voice.narratedScenes > 0 || status.voice.dialogueLinesVoiced > 0) &&
    status.finalRenderCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <StatusRow
            label={project.type === "SINGLE" ? "Story" : "Story Bible"}
            detail={status.storyDone ? "Written" : "Not started"}
            done={status.storyDone}
            href={status.storyHref}
          />
          <StatusRow
            label="Characters"
            detail={`${status.characters.total} (${status.characters.locked} locked)`}
            done={status.characters.total > 0}
            href={`/projects/${id}/characters`}
          />
          <StatusRow
            label="Locations"
            detail={`${status.locations.total}`}
            done={status.locations.total > 0}
            href={`/projects/${id}/locations`}
          />
          <StatusRow
            label="Scenes"
            detail={`${status.scenes.total}`}
            done={status.scenes.total > 0}
            href={status.scenesHref}
          />
          <StatusRow
            label="Shots with images"
            detail={`${status.shots.withImage} / ${status.shots.total}`}
            done={status.shots.total > 0 && status.shots.withImage === status.shots.total}
            href={status.scenesHref}
          />
          <StatusRow
            label="Voice"
            detail={`${status.voice.narratedScenes} scene(s) narrated, ${status.voice.dialogueLinesVoiced}/${status.voice.dialogueLinesTotal} dialogue lines`}
            done={status.voice.narratedScenes > 0 || status.voice.dialogueLinesVoiced > 0}
            href={status.scenesHref}
          />
          <StatusRow
            label="Final render"
            detail={status.finalRenderCount > 0 ? `${status.finalRenderCount} rendered` : "Not rendered yet"}
            done={status.finalRenderCount > 0}
            href={status.scenesHref}
          />
        </CardContent>
      </Card>

      <Button size="lg" className="self-start" render={<Link href={status.nextStepHref} />}>
        {allDone ? "Review your final render" : "Continue"}
      </Button>
    </div>
  );
}
