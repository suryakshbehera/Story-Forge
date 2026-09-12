import type { AiJobType } from "db";
import type { ModelOption } from "@/components/model-select";

const cache = new Map<AiJobType, Promise<ModelOption[]>>();

export function getModelsForJobType(jobType: AiJobType): Promise<ModelOption[]> {
  let entry = cache.get(jobType);
  if (!entry) {
    entry = fetch(`/api/ai-models?jobType=${jobType}&enabledOnly=true`)
      .then((res) => res.json())
      .catch(() => {
        // Don't cache a rejection — the next mount should retry the fetch
        // instead of being stuck with an empty list forever.
        cache.delete(jobType);
        return [];
      });
    cache.set(jobType, entry);
  }
  return entry;
}

export function invalidateModelCache(jobType?: AiJobType) {
  if (jobType) cache.delete(jobType);
  else cache.clear();
}

// One fetch per project (not per jobType — same "dedupe fan-out" reasoning
// as the cache above), returning every job type's override in one payload
// so ModelSelect can look up just the jobType it needs without a
// per-instance round trip.
const projectDefaultsCache = new Map<string, Promise<Record<string, string | null>>>();

export function getProjectModelDefaults(projectId: string): Promise<Record<string, string | null>> {
  let entry = projectDefaultsCache.get(projectId);
  if (!entry) {
    entry = fetch(`/api/projects/${projectId}/model-defaults`)
      .then((res) => res.json())
      .then((rows: { jobType: string; aiModelOptionId: string | null }[]) =>
        Object.fromEntries(rows.map((r) => [r.jobType, r.aiModelOptionId]))
      )
      .catch(() => {
        projectDefaultsCache.delete(projectId);
        return {};
      });
    projectDefaultsCache.set(projectId, entry);
  }
  return entry;
}

export function invalidateProjectModelDefaults(projectId?: string) {
  if (projectId) projectDefaultsCache.delete(projectId);
  else projectDefaultsCache.clear();
}
