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
