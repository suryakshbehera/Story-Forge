"use client";

import { useEffect, useState } from "react";
import type { AiJobType } from "db";

export interface GenerationEstimate {
  medianCostUsd: number | null;
  medianDurationMs: number | null;
  sampleSize: number;
}

// Shared by the pre-flight cost/ETA line on the expensive generate actions
// (scene-video-panel, silent-assembly-panel, video-assembly-panel) — one
// fetch per (jobType, modelId) change instead of each panel rolling its own,
// same "don't duplicate fetch logic" reasoning as model-registry-cache.ts.
// Returns null while loading or if there's nothing to show yet.
export function useGenerationEstimate(
  projectId: string,
  jobType: AiJobType,
  modelId: string | null | undefined
): GenerationEstimate | null {
  const [estimate, setEstimate] = useState<GenerationEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ jobType });
    if (modelId) params.set("modelId", modelId);
    fetch(`/api/projects/${projectId}/estimates?${params}`)
      .then((res) => (res.ok ? (res.json() as Promise<GenerationEstimate>) : null))
      .then((data) => {
        if (!cancelled) setEstimate(data);
      })
      .catch(() => {
        if (!cancelled) setEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, jobType, modelId]);

  return estimate;
}

export function formatEstimate(estimate: GenerationEstimate | null, unitLabel: string): string | null {
  if (!estimate || estimate.sampleSize === 0) return null;
  const parts: string[] = [];
  if (estimate.medianCostUsd != null) parts.push(`~$${estimate.medianCostUsd.toFixed(2)}`);
  if (estimate.medianDurationMs != null) parts.push(`~${Math.round(estimate.medianDurationMs / 1000)}s`);
  if (parts.length === 0) return null;
  return `${parts.join(" · ")} per ${unitLabel}, based on ${estimate.sampleSize} past generation${estimate.sampleSize > 1 ? "s" : ""}.`;
}
