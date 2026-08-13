import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { CharacterDetailForm } from "@/components/character-detail-form";
import { ReferenceImageGallery } from "@/components/reference-image-gallery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string; characterId: string }>;
}) {
  const { id: projectId, characterId } = await params;
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { referenceImages: true },
  });
  if (!character || character.projectId !== projectId) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/projects/${projectId}/characters`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All characters
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Character Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CharacterDetailForm
              characterId={character.id}
              initialFields={{
                name: character.name,
                identity: character.identity ?? "",
                appearance: character.appearance ?? "",
                personality: character.personality ?? "",
                clothing: character.clothing ?? "",
                background: character.background ?? "",
                characterArc: character.characterArc ?? "",
                isLocked: character.isLocked,
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
              uploadUrl={`/api/characters/${character.id}/images`}
              deleteUrlBase={`/api/characters/${character.id}/images`}
              initialImages={character.referenceImages}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
