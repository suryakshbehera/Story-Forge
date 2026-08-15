-- CreateEnum
CREATE TYPE "CameraMovement" AS ENUM ('STATIC', 'ZOOM_IN', 'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT', 'PAN_UP', 'PAN_DOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobType" ADD VALUE 'SHOT_PLANNING';
ALTER TYPE "AiJobType" ADD VALUE 'DIALOGUE_DIRECTION';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "shotId" TEXT;

-- AlterTable
ALTER TABLE "dialogue_lines" ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "speed" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "shots" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "cameraMovement" "CameraMovement" NOT NULL DEFAULT 'STATIC',
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shots_sceneId_order_key" ON "shots"("sceneId", "order");

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
