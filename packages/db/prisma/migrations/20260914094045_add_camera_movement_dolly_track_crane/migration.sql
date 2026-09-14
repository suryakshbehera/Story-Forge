-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CameraMovement" ADD VALUE 'DOLLY_IN';
ALTER TYPE "CameraMovement" ADD VALUE 'DOLLY_OUT';
ALTER TYPE "CameraMovement" ADD VALUE 'TRACK_LEFT';
ALTER TYPE "CameraMovement" ADD VALUE 'TRACK_RIGHT';
ALTER TYPE "CameraMovement" ADD VALUE 'CRANE_UP';
ALTER TYPE "CameraMovement" ADD VALUE 'CRANE_DOWN';
ALTER TYPE "CameraMovement" ADD VALUE 'HANDHELD';
