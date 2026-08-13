import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SeasonsManager } from "@/components/seasons-manager";

export default async function SeasonsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { seasons: { orderBy: { number: "asc" }, include: { episodes: { orderBy: { number: "asc" } } } } },
  });
  if (!project) notFound();
  if (project.type !== "SERIES") redirect(`/projects/${id}/story`);

  return <SeasonsManager projectId={id} initialSeasons={project.seasons} />;
}
