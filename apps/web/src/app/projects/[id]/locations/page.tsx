import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { NewEntityDialog } from "@/components/new-entity-dialog";

export default async function LocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) notFound();

  const locations = await prisma.location.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: { referenceImages: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <NewEntityDialog
          label="Location"
          createUrl={`/api/projects/${projectId}/locations`}
          detailUrlBase={`/projects/${projectId}/locations`}
        />
      </div>

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No locations yet. Add one so scenes can reference it consistently.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l) => (
            <Link key={l.id} href={`/projects/${projectId}/locations/${l.id}`}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardContent className="py-4">
                  <p className="font-medium">{l.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {l.description || "No description yet."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {l.referenceImages.length} reference image{l.referenceImages.length === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
