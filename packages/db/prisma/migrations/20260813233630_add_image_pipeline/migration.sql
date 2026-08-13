-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "createdBy" "CreatedBy" NOT NULL DEFAULT 'USER',
ADD COLUMN     "isSelected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "prompt" TEXT,
ADD COLUMN     "sceneId" TEXT,
ADD COLUMN     "validationModelId" TEXT,
ADD COLUMN     "validationNotes" TEXT,
ADD COLUMN     "validationPassed" BOOLEAN;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
