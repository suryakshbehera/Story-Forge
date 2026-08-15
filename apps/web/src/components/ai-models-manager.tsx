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
import { Plus, Trash2 } from "lucide-react";

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
  "SCRIPT_DRAFTING",
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
  SCRIPT_DRAFTING: "Script Drafting",
};

export interface ModelRow {
  id: string;
  jobType: JobType;
  provider: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
  isEnabled: boolean;
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
        <AddModelDialog onAdd={addModel} />
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
                  <Button size="icon" variant="ghost" onClick={() => deleteModel(m.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddModelDialog({ onAdd }: { onAdd: (input: Omit<ModelRow, "id">) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [jobType, setJobType] = useState<JobType>("MASTER_AI");
  const [provider, setProvider] = useState("openrouter");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    if (!modelId.trim() || !displayName.trim()) {
      toast.error("Model ID and display name are required.");
      return;
    }
    setSubmitting(true);
    await onAdd({
      jobType,
      provider: provider.trim() || "openrouter",
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      isDefault,
      isEnabled: true,
    });
    setSubmitting(false);
    setOpen(false);
    setModelId("");
    setDisplayName("");
    setIsDefault(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        Add Model
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
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
        </div>
        <DialogFooter>
          <Button onClick={handleAdd} disabled={submitting}>
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
