-- AlterEnum
ALTER TYPE "SceneVisualMode" ADD VALUE 'TEXT_TO_VIDEO';

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "videoPrompt" TEXT;
