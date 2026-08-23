-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'SILENT_VIDEO';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "episodeSilentVideoId" TEXT,
ADD COLUMN     "storySilentVideoId" TEXT,
ADD COLUMN     "videoPairIndex" INTEGER;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_storySilentVideoId_fkey" FOREIGN KEY ("storySilentVideoId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_episodeSilentVideoId_fkey" FOREIGN KEY ("episodeSilentVideoId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
