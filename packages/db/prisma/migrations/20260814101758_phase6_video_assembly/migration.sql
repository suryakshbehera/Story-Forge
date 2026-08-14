-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'FINAL_VIDEO';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "episodeVideoId" TEXT,
ADD COLUMN     "storyVideoId" TEXT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_storyVideoId_fkey" FOREIGN KEY ("storyVideoId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_episodeVideoId_fkey" FOREIGN KEY ("episodeVideoId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
