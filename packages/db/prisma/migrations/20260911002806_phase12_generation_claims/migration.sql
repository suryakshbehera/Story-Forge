-- AlterTable
ALTER TABLE "dialogue_lines" ADD COLUMN     "audioGenerationStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "finalVideoGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN     "silentVideoGenerationStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "musicGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN     "narrationGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN     "sfxGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN     "videoGenerationStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shots" ADD COLUMN     "videoModelId" TEXT;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "finalVideoGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN     "silentVideoGenerationStartedAt" TIMESTAMP(3);
