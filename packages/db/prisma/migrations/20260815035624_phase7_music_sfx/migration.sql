-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobType" ADD VALUE 'AUDIO_PLANNING';
ALTER TYPE "AiJobType" ADD VALUE 'MUSIC_GENERATION';
ALTER TYPE "AiJobType" ADD VALUE 'SFX_GENERATION';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "musicSceneId" TEXT,
ADD COLUMN     "sfxSceneId" TEXT;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "musicPrompt" TEXT,
ADD COLUMN     "musicVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
ADD COLUMN     "sfxPrompt" TEXT,
ADD COLUMN     "sfxVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.8;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_musicSceneId_fkey" FOREIGN KEY ("musicSceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sfxSceneId_fkey" FOREIGN KEY ("sfxSceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
