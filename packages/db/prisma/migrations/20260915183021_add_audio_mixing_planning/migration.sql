-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'AUDIO_MIXING_PLANNING';

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "duckMusicUnderDialogue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "musicFadeInSeconds" DOUBLE PRECISION,
ADD COLUMN     "musicFadeOutSeconds" DOUBLE PRECISION;
