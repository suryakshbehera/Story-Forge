-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'TRANSLATION';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "voicesByLanguage" JSONB;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "narratorVoicesByLanguage" JSONB;

-- CreateTable
CREATE TABLE "scene_translations" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "narration" TEXT,
    "narrationDeliveryNotes" TEXT,
    "narrationSpeed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialogue_line_translations" (
    "id" TEXT NOT NULL,
    "dialogueLineId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "deliveryNotes" TEXT,
    "speed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dialogue_line_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scene_translations_sceneId_language_key" ON "scene_translations"("sceneId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "dialogue_line_translations_dialogueLineId_language_key" ON "dialogue_line_translations"("dialogueLineId", "language");

-- AddForeignKey
ALTER TABLE "scene_translations" ADD CONSTRAINT "scene_translations_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_line_translations" ADD CONSTRAINT "dialogue_line_translations_dialogueLineId_fkey" FOREIGN KEY ("dialogueLineId") REFERENCES "dialogue_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
