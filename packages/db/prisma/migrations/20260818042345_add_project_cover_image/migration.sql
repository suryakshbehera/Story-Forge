-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "projectCoverId" TEXT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectCoverId_fkey" FOREIGN KEY ("projectCoverId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
