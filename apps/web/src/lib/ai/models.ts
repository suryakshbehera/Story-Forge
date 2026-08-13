import { prisma, type AiJobType } from "@/lib/db";

// Every model dropdown in the app reads from here — nothing hardcodes a
// model id. Manage entries via Settings → AI Models.
export async function listModelsForJob(jobType: AiJobType) {
  return prisma.aiModelOption.findMany({
    where: { jobType, isEnabled: true },
    orderBy: [{ isDefault: "desc" }, { displayName: "asc" }],
  });
}

export async function getDefaultModelForJob(jobType: AiJobType) {
  const models = await listModelsForJob(jobType);
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

export async function getModelOrDefault(jobType: AiJobType, modelId?: string | null) {
  if (modelId) {
    const model = await prisma.aiModelOption.findUnique({ where: { id: modelId } });
    if (model) return model;
  }
  return getDefaultModelForJob(jobType);
}
