-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "dialogueLineId" TEXT,
ADD COLUMN     "narrationSceneId" TEXT;

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "voiceName" TEXT;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "narration" TEXT;

-- CreateTable
CREATE TABLE "dialogue_lines" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dialogue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dialogue_lines_sceneId_order_key" ON "dialogue_lines"("sceneId", "order");

-- AddForeignKey
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_narrationSceneId_fkey" FOREIGN KEY ("narrationSceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_dialogueLineId_fkey" FOREIGN KEY ("dialogueLineId") REFERENCES "dialogue_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
