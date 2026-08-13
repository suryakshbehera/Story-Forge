import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewProjectDialog } from "@/components/new-project-dialog";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { characters: true, locations: true, seasons: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Single videos and multi-season series, all built manually with AI assistance.
          </p>
        </div>
        <NewProjectDialog />
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <p>No projects yet.</p>
            <p className="text-sm">Create your first Single Video or Series to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant={project.type === "SERIES" ? "default" : "secondary"}>
                      {project.type === "SERIES" ? "Series" : "Single Video"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {project.type === "SERIES" ? (
                    <p>
                      {project._count.seasons} season{project._count.seasons === 1 ? "" : "s"} ·{" "}
                      {project._count.characters} character{project._count.characters === 1 ? "" : "s"} ·{" "}
                      {project._count.locations} location{project._count.locations === 1 ? "" : "s"}
                    </p>
                  ) : (
                    <p>
                      {project._count.characters} character{project._count.characters === 1 ? "" : "s"} ·{" "}
                      {project._count.locations} location{project._count.locations === 1 ? "" : "s"}
                    </p>
                  )}
                  <p className="mt-1">Updated {project.updatedAt.toLocaleDateString("en-US")}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
