-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "projectStyleId" TEXT;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectStyleId_fkey" FOREIGN KEY ("projectStyleId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
