import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReferenceImageGallery } from "@/components/reference-image-gallery";

interface StyleReferenceAsset {
  id: string;
  storageKey: string;
  fileName: string | null;
}

// Project-level visual-style anchor: a locked reference image included in
// every shot image generation call for this project, so style doesn't
// drift generation to generation. Same "first uploaded = the reference"
// convention as Character/Location reference images — see
// Project.styleReferences in schema.prisma.
export function StyleAnchorCard({
  projectId,
  initialImages,
}: {
  projectId: string;
  initialImages: StyleReferenceAsset[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visual Style Anchor</CardTitle>
        <CardDescription>
          Optional. The first image here is sent as a reference on every shot image generation for
          this project, alongside any tagged character/location references — keeps the overall look
          from drifting across scenes and episodes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ReferenceImageGallery
          uploadUrl={`/api/projects/${projectId}/style-reference`}
          deleteUrlBase={`/api/projects/${projectId}/style-reference`}
          initialImages={initialImages}
        />
      </CardContent>
    </Card>
  );
}
