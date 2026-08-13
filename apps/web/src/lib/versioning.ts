import { prisma, type VersionEntityType, type CreatedBy, type Prisma } from "@/lib/db";

interface CreateVersionParams {
  entityType: VersionEntityType;
  entityId: string;
  payload: Prisma.InputJsonValue;
  createdBy: CreatedBy;
  prompt?: string | null;
  modelId?: string | null;
  generationSettings?: Prisma.InputJsonValue;
}

// Generic versioning reused across Story, StoryBible, and later Scene /
// Character / Image entities. entityType + entityId instead of a table per
// kind — see packages/db/prisma/schema.prisma for the rationale.
export async function createVersion({
  entityType,
  entityId,
  payload,
  createdBy,
  prompt,
  modelId,
  generationSettings,
}: CreateVersionParams) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.version.findFirst({
      where: { entityType, entityId },
      orderBy: { versionNumber: "desc" },
    });
    const versionNumber = (last?.versionNumber ?? 0) + 1;

    await tx.version.updateMany({
      where: { entityType, entityId, isSelected: true },
      data: { isSelected: false },
    });

    return tx.version.create({
      data: {
        entityType,
        entityId,
        versionNumber,
        payload,
        isSelected: true,
        createdBy,
        prompt,
        modelId,
        generationSettings,
      },
    });
  });
}

export async function listVersions(entityType: VersionEntityType, entityId: string) {
  return prisma.version.findMany({
    where: { entityType, entityId },
    orderBy: { versionNumber: "desc" },
  });
}

export async function selectVersion(entityType: VersionEntityType, entityId: string, versionId: string) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.version.findUniqueOrThrow({ where: { id: versionId } });
    await tx.version.updateMany({
      where: { entityType, entityId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.version.update({
      where: { id: version.id },
      data: { isSelected: true },
    });
  });
}
