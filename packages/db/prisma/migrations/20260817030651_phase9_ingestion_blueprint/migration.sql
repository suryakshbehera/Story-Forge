-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobType" ADD VALUE 'STORY_INGESTION';
ALTER TYPE "AiJobType" ADD VALUE 'BLUEPRINT_PLANNING';

-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'SOURCE_DOCUMENT';

-- AlterEnum
ALTER TYPE "VersionEntityType" ADD VALUE 'SERIES_BLUEPRINT';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "projectSourceId" TEXT;

-- CreateTable
CREATE TABLE "series_blueprints" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actStructure" TEXT,
    "sceneShotGuidance" TEXT,
    "runtimeTarget" TEXT,
    "tone" TEXT,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "series_blueprints_projectId_key" ON "series_blueprints"("projectId");

-- AddForeignKey
ALTER TABLE "series_blueprints" ADD CONSTRAINT "series_blueprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectSourceId_fkey" FOREIGN KEY ("projectSourceId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
