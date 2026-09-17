-- CreateEnum
CREATE TYPE "CaptureKind" AS ENUM ('IMAGE', 'AUDIO_NOTE', 'LINK', 'TEXT');

-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'CAPTURE';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "captureItemId" TEXT,
ADD COLUMN     "keptAt" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "capture_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "CaptureKind" NOT NULL,
    "text" TEXT,
    "transcript" TEXT,
    "sourceApp" TEXT,
    "filedAt" TIMESTAMP(3),
    "filedIntoType" TEXT,
    "filedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "name" TEXT,
    "mutedProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "timezoneOffsetMinutes" INTEGER,
    "lastNotifiedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capture_items_userId_filedAt_idx" ON "capture_items"("userId", "filedAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_expoPushToken_key" ON "push_devices"("expoPushToken");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_userId_installId_key" ON "push_devices"("userId", "installId");

-- CreateIndex
CREATE INDEX "assets_shotId_isSelected_idx" ON "assets"("shotId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_narrationSceneId_isSelected_idx" ON "assets"("narrationSceneId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_dialogueLineId_isSelected_idx" ON "assets"("dialogueLineId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_videoSceneId_isSelected_idx" ON "assets"("videoSceneId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_musicSceneId_isSelected_idx" ON "assets"("musicSceneId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_sfxSceneId_isSelected_idx" ON "assets"("sfxSceneId", "isSelected");

-- CreateIndex
CREATE INDEX "assets_characterId_idx" ON "assets"("characterId");

-- CreateIndex
CREATE INDEX "assets_locationId_idx" ON "assets"("locationId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_captureItemId_fkey" FOREIGN KEY ("captureItemId") REFERENCES "capture_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_items" ADD CONSTRAINT "capture_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_items" ADD CONSTRAINT "capture_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every asset ever selected before this migration is treated as
-- already reviewed (a human, on web, chose it at some point in the past —
-- there was simply nowhere to record that until now). Without this, every
-- historical selection would flood the mobile review queue on first launch.
-- See docs/product/mobile-technical-plan-2026-09.md §5.2.
UPDATE "assets" SET "reviewedAt" = "createdAt" WHERE "isSelected" = true;
