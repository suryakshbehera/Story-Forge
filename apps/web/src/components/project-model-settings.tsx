"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiJobType } from "db";

const JOB_LABELS: Record<string, string> = {
  STORY_WRITING: "Story Writing",
  SCENE_PLANNING: "Scene Planning",
  SHOT_PLANNING: "Shot Planning",
  IMAGE_PROMPTS: "Image Prompts",
  IMAGE_GENERATION: "Image Generation",
  IMAGE_VALIDATION: "Image Validation",
  SCRIPT_DRAFTING: "Script Drafting",
  NARRATION_DIRECTION: "Narration Direction",
  DIALOGUE_DIRECTION: "Dialogue Direction",
  VOICE: "Voice",
  MOTION_PROMPT_DRAFTING: "Motion Prompt Drafting",
  DURATION_RECOMMENDATION: "Duration Recommendation",
  VIDEO_GENERATION: "Video Generation",
  MUSIC_GENERATION: "Music Generation",
  SFX_GENERATION: "SFX Generation",
  AUDIO_CUE_PLANNING: "Audio Cue Planning",
  VIDEO: "Final Assembly (Video)",
};

const GLOBAL_DEFAULT_VALUE = "__global_default__";

export interface JobModelOptions {
  jobType: AiJobType;
  options: { id: string; displayName: string; isDefault: boolean }[];
  currentAiModelOptionId: string | null;
}

// Per-project override, one tier above AiModelOption.isDefault (the global
// fallback) and one tier below a per-action override where one exists
// (e.g. Shot.videoModelId's own picker) — see ProjectModelDefault in
// schema.prisma. Manual-first: every row defaults to "Global default,"
// never silently pins a project to something the user didn't choose.
export function ProjectModelSettings({ projectId, jobs }: { projectId: string; jobs: JobModelOptions[] }) {
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(jobs.map((j) => [j.jobType, j.currentAiModelOptionId ?? GLOBAL_DEFAULT_VALUE]))
  );
  const [saving, setSaving] = useState<string | null>(null);

  async function update(jobType: AiJobType, value: string) {
    setSelections((prev) => ({ ...prev, [jobType]: value }));
    setSaving(jobType);
    try {
      const res = await fetch(`/api/projects/${projectId}/model-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType, aiModelOptionId: value === GLOBAL_DEFAULT_VALUE ? null : value }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved.");
    } catch {
      toast.error("Couldn't save — try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col divide-y">
      {jobs.map((job) => {
        const globalDefault = job.options.find((o) => o.isDefault);
        const items: Record<string, string> = {
          [GLOBAL_DEFAULT_VALUE]: globalDefault ? `Global default (${globalDefault.displayName})` : "Global default",
        };
        for (const o of job.options) items[o.id] = o.displayName;

        return (
          <div key={job.jobType} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm">{JOB_LABELS[job.jobType] ?? job.jobType}</span>
            <Select
              value={selections[job.jobType]}
              onValueChange={(v) => v && update(job.jobType, v)}
              items={items}
              disabled={saving === job.jobType}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_DEFAULT_VALUE}>
                  {globalDefault ? `Global default (${globalDefault.displayName})` : "Global default"}
                </SelectItem>
                {job.options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
