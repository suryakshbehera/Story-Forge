"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import type { VideoModelConfig } from "@/lib/video-model-config";

const JOB_TYPES = [
  "MASTER_AI",
  "STORY_WRITING",
  "SCENE_PLANNING",
  "IMAGE_PROMPTS",
  "IMAGE_GENERATION",
  "IMAGE_VALIDATION",
  "VOICE",
  "VIDEO_GENERATION",
  "VIDEO",
  "AUDIO_PLANNING",
  "MUSIC_GENERATION",
  "SFX_GENERATION",
  "SHOT_PLANNING",
  "DIALOGUE_DIRECTION",
  "NARRATION_DIRECTION",
  "SCRIPT_DRAFTING",
  "STORY_CHAT",
  "STORY_INGESTION",
  "BLUEPRINT_PLANNING",
  "MOTION_PROMPT_DRAFTING",
  "AUDIO_CUE_PLANNING",
] as const;

type JobType = (typeof JOB_TYPES)[number];

const JOB_LABELS: Record<JobType, string> = {
  MASTER_AI: "Master AI",
  STORY_WRITING: "Story Writing",
  SCENE_PLANNING: "Scene Planning",
  IMAGE_PROMPTS: "Image Prompts",
  IMAGE_GENERATION: "Image Generation",
  IMAGE_VALIDATION: "Image Validation",
  VOICE: "Voice",
  VIDEO_GENERATION: "Video Generation",
  VIDEO: "Video",
  AUDIO_PLANNING: "Audio Planning",
  MUSIC_GENERATION: "Music Generation",
  SFX_GENERATION: "SFX Generation",
  SHOT_PLANNING: "Shot Planning",
  DIALOGUE_DIRECTION: "Dialogue Direction",
  NARRATION_DIRECTION: "Narration Direction",
  SCRIPT_DRAFTING: "Script Drafting",
  STORY_CHAT: "Story Chat",
  STORY_INGESTION: "Story Ingestion",
  BLUEPRINT_PLANNING: "Blueprint Planning",
  MOTION_PROMPT_DRAFTING: "Motion Prompt Drafting",
  AUDIO_CUE_PLANNING: "Audio Cue Planning",
};

export interface ModelRow {
  id: string;
  jobType: JobType;
  provider: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
  isEnabled: boolean;
  config?: VideoModelConfig | null;
}

export function AiModelsManager({ initialModels }: { initialModels: ModelRow[] }) {
  const [models, setModels] = useState(initialModels);

  async function addModel(input: Omit<ModelRow, "id">) {
    const res = await fetch("/api/ai-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      toast.error("Couldn't add model.");
      return;
    }
    const created: ModelRow = await res.json();
    setModels((prev) => {
      const next = input.isDefault
        ? prev.map((m) => (m.jobType === input.jobType ? { ...m, isDefault: false } : m))
        : prev;
      return [...next, created];
    });
    toast.success("Model added.");
  }

  async function updateModel(id: string, patch: Partial<Omit<ModelRow, "id" | "jobType">>) {
    const res = await fetch(`/api/ai-models/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Couldn't update model.");
      return;
    }
    const updated: ModelRow = await res.json();
    setModels((prev) =>
      prev.map((m) => {
        if (m.id === id) return updated;
        if (patch.isDefault && m.jobType === updated.jobType) return { ...m, isDefault: false };
        return m;
      })
    );
  }

  async function deleteModel(id: string) {
    if (!confirm("Remove this model from the registry?")) return;
    const res = await fetch(`/api/ai-models/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete model.");
      return;
    }
    setModels((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ModelDialog mode="add" onSubmit={addModel} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model ID</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Badge variant="outline">{JOB_LABELS[m.jobType]}</Badge>
                </TableCell>
                <TableCell className="font-medium">{m.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{m.provider}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{m.modelId}</TableCell>
                <TableCell>
                  <Switch
                    checked={m.isDefault}
                    onCheckedChange={(v) => updateModel(m.id, { isDefault: v })}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={m.isEnabled}
                    onCheckedChange={(v) => updateModel(m.id, { isEnabled: v })}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <ModelDialog
                      mode="edit"
                      initial={m}
                      onSubmit={(patch) => updateModel(m.id, patch)}
                      trigger={
                        <Button size="icon" variant="ghost">
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <Button size="icon" variant="ghost" onClick={() => deleteModel(m.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Admin-entered capabilities for VIDEO_GENERATION models (see
// video-model-config.ts / video-segmentation.ts) — how many clips a scene
// needs and at what duration/resolution is computed from this, since
// OpenRouter has no confirmed live endpoint for per-model capabilities.
function VideoConfigFields({
  config,
  onChange,
}: {
  config: VideoModelConfig;
  onChange: (config: VideoModelConfig) => void;
}) {
  const durationMode = config.durationMode ?? "fixed";
  const fixedDurationsText = (config.fixedDurations ?? []).join(", ");
  const resolutionsText = (config.resolutions ?? []).join(", ");

  function parseNumberList(text: string): number[] {
    return text
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">Video generation capabilities</p>
      <div className="grid gap-2">
        <Label>Duration mode</Label>
        <Select
          value={durationMode}
          onValueChange={(v) => onChange({ ...config, durationMode: v as "fixed" | "range" })}
          items={{ fixed: "Fixed steps (e.g. 4/6/8s)", range: "Min–max range (e.g. 1–15s)" }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed steps (e.g. 4/6/8s)</SelectItem>
            <SelectItem value="range">Min–max range (e.g. 1–15s)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {durationMode === "fixed" ? (
        <div className="grid gap-2">
          <Label>Allowed durations, seconds (comma-separated)</Label>
          <Input
            placeholder="4, 6, 8"
            defaultValue={fixedDurationsText}
            onBlur={(e) => onChange({ ...config, fixedDurations: parseNumberList(e.target.value) })}
          />
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="grid gap-2">
            <Label>Min seconds</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              defaultValue={config.minDurationSeconds ?? ""}
              onBlur={(e) => onChange({ ...config, minDurationSeconds: Number(e.target.value) || undefined })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Max seconds</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              defaultValue={config.maxDurationSeconds ?? ""}
              onBlur={(e) => onChange({ ...config, maxDurationSeconds: Number(e.target.value) || undefined })}
            />
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Resolutions (comma-separated, first = default)</Label>
        <Input
          placeholder="480p, 720p"
          defaultValue={resolutionsText}
          onBlur={(e) =>
            onChange({
              ...config,
              resolutions: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={config.supportsNativeAudio ?? false}
          onCheckedChange={(v) => onChange({ ...config, supportsNativeAudio: v })}
        />
        Supports native audio generation
      </label>
    </div>
  );
}

function ModelDialog({
  mode,
  initial,
  onSubmit,
  trigger,
}: {
  mode: "add" | "edit";
  initial?: ModelRow;
  onSubmit: (input: Omit<ModelRow, "id">) => Promise<void>;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [jobType, setJobType] = useState<JobType>(initial?.jobType ?? "MASTER_AI");
  const [provider, setProvider] = useState(initial?.provider ?? "openrouter");
  const [modelId, setModelId] = useState(initial?.modelId ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [videoConfig, setVideoConfig] = useState<VideoModelConfig>(
    initial?.config ?? { durationMode: "fixed", fixedDurations: [], resolutions: [] }
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!modelId.trim() || !displayName.trim()) {
      toast.error("Model ID and display name are required.");
      return;
    }
    setSubmitting(true);
    await onSubmit({
      jobType,
      provider: provider.trim() || "openrouter",
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      isDefault,
      isEnabled: initial?.isEnabled ?? true,
      config: jobType === "VIDEO_GENERATION" ? videoConfig : undefined,
    });
    setSubmitting(false);
    setOpen(false);
    if (mode === "add") {
      setModelId("");
      setDisplayName("");
      setIsDefault(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button />}>
        {!trigger && (
          <>
            <Plus className="size-4" />
            Add Model
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add Model" : "Edit Model"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Job</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v as JobType)} items={JOB_LABELS}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOB_TYPES.map((jt) => (
                  <SelectItem key={jt} value={jt}>
                    {JOB_LABELS[jt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Provider</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openrouter" />
          </div>
          <div className="grid gap-2">
            <Label>Model ID</Label>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="e.g. anthropic/claude-sonnet-5"
            />
          </div>
          <div className="grid gap-2">
            <Label>Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Claude Sonnet 5"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            Make default for this job
          </label>

          {jobType === "VIDEO_GENERATION" && <VideoConfigFields config={videoConfig} onChange={setVideoConfig} />}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : mode === "add" ? "Add" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
