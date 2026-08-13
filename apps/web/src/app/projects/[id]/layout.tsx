import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import { ArrowLeft } from "lucide-react";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All projects
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant={project.type === "SERIES" ? "default" : "secondary"}>
            {project.type === "SERIES" ? "Series" : "Single Video"}
          </Badge>
        </div>
      </div>
      <ProjectNav projectId={project.id} type={project.type} />
      <div>{children}</div>
    </div>
  );
}
