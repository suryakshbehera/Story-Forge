import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SeasonsManager } from "@/components/seasons-manager";
import { serializeFinalVideo } from "@/lib/video-assembly";

export default async function SeasonsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      seasons: {
        orderBy: { number: "asc" },
        include: {
          episodes: {
            orderBy: { number: "asc" },
            // Only the *selected* take per language — this is an overview,
            // not the take history (that stays on the episode page). One row
            // per language is what makes "is this episode done, and in which
            // languages?" answerable without opening every episode.
            include: { finalVideos: { where: { isSelected: true }, orderBy: { createdAt: "desc" } } },
          },
        },
      },
    },
  });
  if (!project) notFound();
  if (project.type !== "SERIES") redirect(`/projects/${id}/story`);

  const seasons = project.seasons.map((season) => ({
    ...season,
    episodes: season.episodes.map((episode) => ({
      ...episode,
      // Primary-language render first, then dubs by language — createdAt
      // order would put whichever dub rendered last in front of the original.
      finalVideos: episode.finalVideos
        .map(serializeFinalVideo)
        .sort((a, b) => (a.language ?? "").localeCompare(b.language ?? "")),
    })),
  }));

  return <SeasonsManager projectId={id} initialSeasons={seasons} />;
}
