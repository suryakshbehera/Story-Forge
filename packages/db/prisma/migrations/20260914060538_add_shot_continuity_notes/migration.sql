-- CreateEnum
CREATE TYPE "GenerationEntityType" AS ENUM ('SCENE', 'SHOT', 'DIALOGUE_LINE');

-- AlterTable
ALTER TABLE "shots" ADD COLUMN     "continuityNotes" TEXT;

-- CreateTable
CREATE TABLE "generation_events" (
    "id" TEXT NOT NULL,
    "jobType" "AiJobType" NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT,
    "projectId" TEXT NOT NULL,
    "entityType" "GenerationEntityType",
    "entityId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_events_projectId_idx" ON "generation_events"("projectId");

-- CreateIndex
CREATE INDEX "generation_events_jobType_idx" ON "generation_events"("jobType");
