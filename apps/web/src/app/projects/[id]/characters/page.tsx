import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewEntityDialog } from "@/components/new-entity-dialog";
import { Lock } from "lucide-react";

export default async function CharactersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) notFound();

  const characters = await prisma.character.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: { referenceImages: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <NewEntityDialog
          label="Character"
          createUrl={`/api/projects/${projectId}/characters`}
          detailUrlBase={`/projects/${projectId}/characters`}
        />
      </div>

      {characters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No characters yet. Add one and Lock it to keep it consistent across every generation.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <Link key={c.id} href={`/projects/${projectId}/characters/${c.id}`}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardContent className="flex items-start justify-between gap-2 py-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {c.appearance || c.identity || "No description yet."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {c.referenceImages.length} reference image{c.referenceImages.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {c.isLocked && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Lock className="size-3" />
                      Locked
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
