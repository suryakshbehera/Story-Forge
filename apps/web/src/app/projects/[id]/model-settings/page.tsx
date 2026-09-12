import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectModelSettings, type JobModelOptions } from "@/components/project-model-settings";
import { JOB_TYPES } from "@/app/api/projects/[id]/model-defaults/route";

export default async function ProjectModelSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  const [allOptions, overrides] = await Promise.all([
    prisma.aiModelOption.findMany({
      where: { jobType: { in: [...JOB_TYPES] }, isEnabled: true },
      orderBy: [{ jobType: "asc" }, { isDefault: "desc" }, { displayName: "asc" }],
    }),
    prisma.projectModelDefault.findMany({ where: { projectId: id } }),
  ]);

  const overrideByJobType = new Map(overrides.map((o) => [o.jobType, o.aiModelOptionId]));
  const jobs: JobModelOptions[] = JOB_TYPES.map((jobType) => ({
    jobType,
    options: allOptions
      .filter((o) => o.jobType === jobType)
      .map((o) => ({ id: o.id, displayName: o.displayName, isDefault: o.isDefault })),
    currentAiModelOptionId: overrideByJobType.get(jobType) ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Model Settings</h2>
        <p className="text-sm text-muted-foreground">
          Preferred model per job type for this project — falls back to the global default (Settings → AI Models)
          when left unset. Some actions (e.g. a shot&apos;s own video-model override) still let you pick a
          different model for that one call.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferred models</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectModelSettings projectId={id} jobs={jobs} />
        </CardContent>
      </Card>
    </div>
  );
}
