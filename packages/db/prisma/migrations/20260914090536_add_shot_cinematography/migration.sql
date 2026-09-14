-- CreateEnum
CREATE TYPE "ShotSize" AS ENUM ('EXTREME_WIDE', 'WIDE', 'FULL', 'MEDIUM', 'MEDIUM_CLOSE_UP', 'CLOSE_UP', 'EXTREME_CLOSE_UP');

-- CreateEnum
CREATE TYPE "CameraAngle" AS ENUM ('EYE_LEVEL', 'LOW', 'HIGH', 'OVERHEAD', 'DUTCH', 'OVER_THE_SHOULDER', 'POV');

-- CreateEnum
CREATE TYPE "ShotFraming" AS ENUM ('SINGLE', 'TWO_SHOT', 'THREE_SHOT', 'GROUP', 'INSERT', 'ESTABLISHING');

-- CreateEnum
CREATE TYPE "DepthOfField" AS ENUM ('SHALLOW', 'MEDIUM', 'DEEP');

-- CreateEnum
CREATE TYPE "LightingStyle" AS ENUM ('NATURAL', 'SOFT', 'HARD', 'HIGH_KEY', 'LOW_KEY', 'BACKLIT', 'SILHOUETTE', 'GOLDEN_HOUR', 'MOONLIT', 'PRACTICAL');

-- CreateEnum
CREATE TYPE "ShotComposition" AS ENUM ('CENTERED', 'RULE_OF_THIRDS', 'SYMMETRICAL', 'LEADING_LINES', 'FRAME_WITHIN_FRAME', 'NEGATIVE_SPACE', 'DIAGONAL');

-- AlterTable
ALTER TABLE "shots" ADD COLUMN     "cameraAngle" "CameraAngle",
ADD COLUMN     "composition" "ShotComposition",
ADD COLUMN     "depthOfField" "DepthOfField",
ADD COLUMN     "focusPoint" TEXT,
ADD COLUMN     "framing" "ShotFraming",
ADD COLUMN     "lensMm" INTEGER,
ADD COLUMN     "lightingStyle" "LightingStyle",
ADD COLUMN     "shotSize" "ShotSize",
ADD COLUMN     "subjectMovement" TEXT;
