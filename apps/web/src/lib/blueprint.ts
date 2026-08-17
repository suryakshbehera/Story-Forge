import { prisma } from "@/lib/db";

// Series Blueprint is additive and postdates plenty of existing SERIES
// projects, so routes can't assume the row exists the way StoryBible's
// routes do (StoryBible is created alongside its Project). Every write path
// goes through here: verify the project is actually a Series, then upsert
// so a pre-existing series self-heals a blueprint row on first touch.
export class NotSeriesProjectError extends Error {
  constructor() {
    super("This project is not a Series — Series Blueprint doesn't apply to Single Video projects.");
  }
}

export async function getOrCreateBlueprint(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.type !== "SERIES") {
    throw new NotSeriesProjectError();
  }
  return prisma.seriesBlueprint.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });
}
