import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export default async function ProjectIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();
  redirect(project.type === "SINGLE" ? `/projects/${id}/story` : `/projects/${id}/bible`);
}
