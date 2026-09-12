-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "qcNotes" TEXT,
ADD COLUMN     "qcPassed" BOOLEAN;

-- CreateTable
CREATE TABLE "project_model_defaults" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobType" "AiJobType" NOT NULL,
    "aiModelOptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_model_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_model_defaults_projectId_jobType_key" ON "project_model_defaults"("projectId", "jobType");

-- AddForeignKey
ALTER TABLE "project_model_defaults" ADD CONSTRAINT "project_model_defaults_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_model_defaults" ADD CONSTRAINT "project_model_defaults_aiModelOptionId_fkey" FOREIGN KEY ("aiModelOptionId") REFERENCES "ai_model_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
