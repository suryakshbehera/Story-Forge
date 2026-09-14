import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma, type AiJobType } from "@/lib/db";
import { getProjectStatus } from "@/lib/project-status";
import { getProjectSpend } from "@/lib/generation-events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";

// Only the metered job types (see generation-events.ts's getProjectSpend)
// ever appear here — every other AiJobType is a planning/prompting call
// that isn't cost-tracked (see narrata-cost-capture-built), so it never
// shows up in a groupBy on GenerationEvent regardless of this map.
const SPEND_JOB_TYPE_LABELS: Partial<Record<AiJobType, string>> = {
  IMAGE_GENERATION: "Images",
  VIDEO_GENERATION: "Video clips",
  VOICE: "Voice",
  MUSIC_GENERATION: "Music",
  SFX_GENERATION: "SFX",
};

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

  const [status, spend] = await Promise.all([getProjectStatus(id, project.type), getProjectSpend(id)]);
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend to date</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">${spend.totalUsd.toFixed(2)}</p>
          {spend.byJobType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paid generations yet.</p>
          ) : (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {spend.byJobType.map((group) => (
                <div key={group.jobType} className="flex items-center justify-between">
                  <span>{SPEND_JOB_TYPE_LABELS[group.jobType] ?? group.jobType}</span>
                  <span>${group.totalUsd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button size="lg" render={<Link href={status.nextStepHref} />}>
          {allDone ? "Review your final render" : "Continue"}
        </Button>
        <Button variant="outline" render={<Link href={`/projects/${id}/model-settings`} />}>
          Model Settings
        </Button>
      </div>
    </div>
  );
}
