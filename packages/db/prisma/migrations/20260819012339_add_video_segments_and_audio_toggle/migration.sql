-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "videoBatchId" TEXT,
ADD COLUMN     "videoSegmentOrder" INTEGER;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "videoGenerateAudio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "videoResolution" TEXT;
