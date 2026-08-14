-- CreateEnum
CREATE TYPE "SceneCameraMovement" AS ENUM ('STATIC', 'ZOOM_IN', 'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT', 'PAN_UP', 'PAN_DOWN');

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "cameraMovement" "SceneCameraMovement" NOT NULL DEFAULT 'STATIC';
