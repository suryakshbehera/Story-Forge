import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { LocationDetailForm } from "@/components/location-detail-form";
import { ReferenceImageGallery } from "@/components/reference-image-gallery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string; locationId: string }>;
}) {
  const { id: projectId, locationId } = await params;
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { referenceImages: true },
  });
  if (!location || location.projectId !== projectId) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/projects/${projectId}/locations`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All locations
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Location Details</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationDetailForm
              locationId={location.id}
              initialFields={{
                name: location.name,
                description: location.description ?? "",
                architecture: location.architecture ?? "",
                environment: location.environment ?? "",
                timeWeather: location.timeWeather ?? "",
                visualStyle: location.visualStyle ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reference Images</CardTitle>
          </CardHeader>
          <CardContent>
            <ReferenceImageGallery
              uploadUrl={`/api/locations/${location.id}/images`}
              deleteUrlBase={`/api/locations/${location.id}/images`}
              initialImages={location.referenceImages}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
