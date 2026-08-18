-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'NARRATION_DIRECTION';

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "narrationDeliveryNotes" TEXT,
ADD COLUMN     "narrationSpeed" DOUBLE PRECISION;
