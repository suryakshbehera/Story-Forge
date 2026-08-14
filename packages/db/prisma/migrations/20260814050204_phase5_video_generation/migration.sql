-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'VIDEO_GENERATION';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "sourceImageId" TEXT,
ADD COLUMN     "videoSceneId" TEXT;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "motionPrompt" TEXT,
ADD COLUMN     "videoDurationSeconds" INTEGER;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_videoSceneId_fkey" FOREIGN KEY ("videoSceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
