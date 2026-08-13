import { prisma } from "@/lib/db";
import { AiModelsManager } from "@/components/ai-models-manager";

export default async function AiModelsSettingsPage() {
  const models = await prisma.aiModelOption.findMany({
    orderBy: [{ jobType: "asc" }, { isDefault: "desc" }, { displayName: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Models</h1>
        <p className="text-sm text-muted-foreground">
          Every model dropdown in Narrata reads from this registry — nothing is hardcoded. Add, disable,
          or change the default per job here.
        </p>
      </div>
      <AiModelsManager initialModels={models} />
    </div>
  );
}
