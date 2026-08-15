-- DropForeignKey
ALTER TABLE "assets" DROP CONSTRAINT "assets_sceneId_fkey";

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "sceneId";

-- AlterTable
ALTER TABLE "scenes" DROP COLUMN "cameraMovement";

-- DropEnum
DROP TYPE "SceneCameraMovement";
