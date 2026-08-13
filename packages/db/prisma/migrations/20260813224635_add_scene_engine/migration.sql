-- CreateEnum
CREATE TYPE "SceneVisualMode" AS ENUM ('ILLUSTRATION', 'IMAGE_TO_VIDEO');

-- CreateTable
CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "episodeId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "visualMode" "SceneVisualMode" NOT NULL DEFAULT 'ILLUSTRATION',
    "visualModeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CharacterToScene" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CharacterToScene_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_LocationToScene" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LocationToScene_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "scenes_storyId_order_key" ON "scenes"("storyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_episodeId_order_key" ON "scenes"("episodeId", "order");

-- CreateIndex
CREATE INDEX "_CharacterToScene_B_index" ON "_CharacterToScene"("B");

-- CreateIndex
CREATE INDEX "_LocationToScene_B_index" ON "_LocationToScene"("B");

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CharacterToScene" ADD CONSTRAINT "_CharacterToScene_A_fkey" FOREIGN KEY ("A") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CharacterToScene" ADD CONSTRAINT "_CharacterToScene_B_fkey" FOREIGN KEY ("B") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationToScene" ADD CONSTRAINT "_LocationToScene_A_fkey" FOREIGN KEY ("A") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationToScene" ADD CONSTRAINT "_LocationToScene_B_fkey" FOREIGN KEY ("B") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
