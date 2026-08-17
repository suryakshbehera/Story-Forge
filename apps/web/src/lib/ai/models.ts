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
    // Scoped to jobType, not just id — a client sending a modelId that
    // belongs to a *different* job (a stale cache, a client-side bug like
    // the one that motivated this check) must not silently route to the
    // wrong model. Falling through to the job's own default is safer than
    // either using the mismatched model or hard-erroring.
    const model = await prisma.aiModelOption.findFirst({ where: { id: modelId, jobType } });
    if (model) return model;
  }
  return getDefaultModelForJob(jobType);
}
