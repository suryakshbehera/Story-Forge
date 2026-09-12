"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelect, type ModelOption } from "@/components/model-select";
import { parseVideoModelConfig } from "@/lib/video-model-config";
import { groupIntoTakes, type SceneVideoClipItem, type VideoTake as Take } from "@/lib/video-takes";
import { Clapperboard, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import {
  assembleVideoPrompt,
  EMPTY_PROMPT_BUILDER_FIELDS,
  PromptBuilderFieldsForm,
  VideoPromptTroubleshooting,
  type PromptBuilderFields,
} from "@/components/video-prompt-builder";

export interface SeedanceSceneOption {
  id: string;
  order: number;
  title: string | null;
  description: string;
  visualMode: "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  groupLabel: string | null;
  motionPrompt: string | null;
  videoPrompt: string | null;
  videoDurationSeconds: number | null;
  videoResolution: string | null;
  videoGenerateAudio: boolean;
  shots: { id: string; order: number; images: { id: string; url: string; isSelected: boolean }[] }[];
  videoClips: SceneVideoClipItem[];
  castReferences: {
    characters: { id: string; name: string; isLocked: boolean; imageUrl: string | null }[];
    locations: { id: string; name: string; imageUrl: string | null }[];
  };
}

export function SeedanceStudio({
  scenes: initialScenes,
  projectId,
  projectType,
}: {
  scenes: SeedanceSceneOption[];
  projectId: string;
  projectType: "SINGLE" | "SERIES";
}) {
  const [scenes, setScenes] = useState(initialScenes);
  const [sceneId, setSceneId] = useState(initialScenes[0]?.id ?? "");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const scene = scenes.find((s) => s.id === sceneId);

  function updateScene(id: string, updater: (s: SeedanceSceneOption) => SeedanceSceneOption) {
    setScenes((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  if (initialScenes.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          No scenes are set to Image → Video or Text → Video yet. Set a scene&apos;s Visual Mode
          {projectType === "SINGLE" ? " on the Scenes page first." : " on one of the episode pages first."}
        </p>
        {projectType === "SINGLE" && (
          <Button size="sm" variant="outline" render={<Link href={`/projects/${projectId}/story/scenes`} />}>
            Go to Scenes
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scene</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select
            value={sceneId}
            onValueChange={(v) => v && setSceneId(v)}
            items={Object.fromEntries(
              scenes.map((s) => [s.id, `${s.groupLabel ? `${s.groupLabel} · ` : ""}Scene ${s.order}${s.title ? ` — ${s.title}` : ""}`])
            )}
          >
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenes.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.groupLabel ? `${s.groupLabel} · ` : ""}Scene {s.order}
                  {s.title ? ` — ${s.title}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scene && <p className="text-sm text-muted-foreground">{scene.description}</p>}

          {scene?.visualMode === "IMAGE_TO_VIDEO" && (
            <div className="flex flex-wrap gap-2">
              {scene.shots.map((shot) => {
                const image = shot.images.find((img) => img.isSelected) ?? shot.images[0];
                return image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={shot.id} src={image.url} alt={`Shot ${shot.order}`} className="h-20 w-20 rounded object-cover" />
                ) : (
                  <div key={shot.id} className="flex h-20 w-20 items-center justify-center rounded border text-xs text-muted-foreground">
                    No image
                  </div>
                );
              })}
              <p className="w-full text-xs text-muted-foreground">
                These shot images are the keyframes (first/last frame per shot pair). Cast/location references below ride
                along separately as identity/style guidance.
              </p>
            </div>
          )}

          {scene && (scene.castReferences.characters.length > 0 || scene.castReferences.locations.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Cast &amp; location references</Label>
              <div className="flex flex-wrap gap-2">
                {scene.castReferences.characters.map((c) => (
                  <div key={c.id} className="flex flex-col items-center gap-1">
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt={c.name} className={`h-16 w-16 rounded object-cover ${c.isLocked ? "ring-2 ring-foreground" : "opacity-50"}`} />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded border text-xs text-muted-foreground">No image</div>
                    )}
                    <span className="max-w-16 truncate text-center text-xs text-muted-foreground" title={c.name}>
                      {c.name}
                    </span>
                  </div>
                ))}
                {scene.castReferences.locations.map((l) => (
                  <div key={l.id} className="flex flex-col items-center gap-1">
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.imageUrl} alt={l.name} className="h-16 w-16 rounded object-cover ring-2 ring-foreground" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded border text-xs text-muted-foreground">No image</div>
                    )}
                    <span className="max-w-16 truncate text-center text-xs text-muted-foreground" title={l.name}>
                      {l.name}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Highlighted (ringed) entries are what actually get sent as references when the toggle below is on — locked
                characters and all tagged locations, same roster Image Generation already uses for consistency. Unlocked
                characters (dimmed) and entries with no uploaded reference image are skipped.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {scene && (
        <SeedanceSceneForm
          key={scene.id}
          scene={scene}
          modelId={modelId}
          models={models}
          onModelIdChange={setModelId}
          onModelsChange={setModels}
          onSceneUpdate={(updater) => updateScene(scene.id, updater)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Troubleshooting</CardTitle>
        </CardHeader>
        <CardContent>
          <VideoPromptTroubleshooting />
        </CardContent>
      </Card>
    </div>
  );
}

// Mounted with key={scene.id} by the parent so every field below resets to
// its scene-derived initial value on scene switch just by remounting —
// no effect-driven reset needed (see React's "resetting state on prop
// change" pattern). Re-renders in place (state preserved) for updates to
// the *same* scene, e.g. after generate()/selectTake() below.
function SeedanceSceneForm({
  scene,
  modelId,
  models,
  onModelIdChange,
  onModelsChange,
  onSceneUpdate,
}: {
  scene: SeedanceSceneOption;
  modelId: string;
  models: ModelOption[];
  onModelIdChange: (id: string) => void;
  onModelsChange: (models: ModelOption[]) => void;
  onSceneUpdate: (updater: (s: SeedanceSceneOption) => SeedanceSceneOption) => void;
}) {
  const [fields, setFields] = useState<PromptBuilderFields>(EMPTY_PROMPT_BUILDER_FIELDS);
  const [duration, setDuration] = useState(scene.videoDurationSeconds?.toString() ?? "");
  const [resolution, setResolution] = useState(scene.videoResolution ?? "");
  const [generateAudio, setGenerateAudio] = useState(scene.videoGenerateAudio);
  const [includeCastReferences, setIncludeCastReferences] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  const assembled = useMemo(() => assembleVideoPrompt(fields), [fields]);
  const savedPrompt = scene.visualMode === "IMAGE_TO_VIDEO" ? scene.motionPrompt : scene.videoPrompt;

  const selectedModel = models.find((m) => m.id === modelId);
  const modelConfig = parseVideoModelConfig(selectedModel?.config);
  const resolutionOptions = modelConfig?.resolutions ?? [];

  const allShotsHaveImages = scene.shots.length > 0 && scene.shots.every((s) => s.images.some((img) => img.isSelected));
  const canGenerate = scene.visualMode === "TEXT_TO_VIDEO" || allShotsHaveImages;
  const takes = groupIntoTakes(scene.videoClips);
  const hasCastReferences = scene.castReferences.characters.some((c) => c.isLocked && c.imageUrl) || scene.castReferences.locations.some((l) => l.imageUrl);

  async function generate() {
    if (!modelId) {
      toast.error("Pick a video generation model first.");
      return;
    }
    setGenerating(true);
    try {
      const promptField = scene.visualMode === "IMAGE_TO_VIDEO" ? "motionPrompt" : "videoPrompt";
      const patchRes = await fetch(`/api/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [promptField]: assembled || null,
          videoDurationSeconds: duration ? Number(duration) : null,
          videoResolution: resolution || null,
          videoGenerateAudio: generateAudio,
        }),
      });
      if (!patchRes.ok) throw new Error("Couldn't save the prompt to this scene.");

      const genRes = await fetch(`/api/scenes/${scene.id}/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, includeCastReferences: hasCastReferences && includeCastReferences }),
      });
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed.");
      }
      const clips: SceneVideoClipItem[] = await genRes.json();
      onSceneUpdate((s) => ({
        ...s,
        [promptField]: assembled || null,
        videoClips: [...clips, ...s.videoClips.map((c) => ({ ...c, isSelected: false }))],
      }));
      toast.success(clips.length > 1 ? `${clips.length} clips generated.` : "Video clip generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function selectTake(clipId: string) {
    const res = await fetch(`/api/scenes/${scene.id}/video/${clipId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select this take.");
      return;
    }
    const selectedBatch: SceneVideoClipItem[] = await res.json();
    const selectedIds = new Set(selectedBatch.map((c) => c.id));
    onSceneUpdate((s) => ({ ...s, videoClips: s.videoClips.map((c) => ({ ...c, isSelected: selectedIds.has(c.id) })) }));
  }

  async function deleteTake(take: Take) {
    const ok = await confirm({
      title: "Delete this take?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/scenes/${scene.id}/video/${take.clips[0].id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    const idsToRemove = new Set(take.clips.map((c) => c.id));
    onSceneUpdate((s) => ({ ...s, videoClips: s.videoClips.filter((c) => !idsToRemove.has(c.id)) }));
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt builder</CardTitle>
        </CardHeader>
        <CardContent>
          <PromptBuilderFieldsForm fields={fields} onChange={setFields} assembled={assembled} savedPrompt={savedPrompt} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Model</Label>
              <div className="mt-1.5">
                <ModelSelect jobType="VIDEO_GENERATION" value={modelId} onChange={onModelIdChange} onModelsChange={onModelsChange} />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Duration</Label>
              <div className="mt-1.5">
                {modelConfig?.durationMode === "fixed" && modelConfig.fixedDurations?.length ? (
                  <Select
                    value={duration || String(modelConfig.fixedDurations[0])}
                    onValueChange={(v) => v && setDuration(v)}
                    items={Object.fromEntries(modelConfig.fixedDurations.map((d) => [String(d), `${d}s`]))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelConfig.fixedDurations.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}s
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    min={modelConfig?.minDurationSeconds ?? 1}
                    max={modelConfig?.maxDurationSeconds ?? 30}
                    className="w-24"
                    placeholder="seconds"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                )}
              </div>
            </div>

            {resolutionOptions.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Resolution</Label>
                <Select
                  value={resolution || resolutionOptions[0]}
                  onValueChange={(v) => v && setResolution(v)}
                  items={Object.fromEntries(resolutionOptions.map((r) => [r, r]))}
                >
                  <SelectTrigger className="mt-1.5 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {resolutionOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <label className="mb-1.5 flex items-center gap-2 text-sm">
              <Switch checked={generateAudio} onCheckedChange={setGenerateAudio} />
              Native audio
            </label>

            {hasCastReferences && (
              <label className="mb-1.5 flex items-center gap-2 text-sm">
                <Switch checked={includeCastReferences} onCheckedChange={setIncludeCastReferences} />
                Include cast/location references
              </label>
            )}
          </div>

          {!canGenerate ? (
            <p className="text-xs text-muted-foreground">
              {scene.shots.length === 0
                ? "This scene has no shots yet — add at least one shot with a selected image on the Scenes page first."
                : "Every shot in this scene needs a selected image before generating a video clip."}
            </p>
          ) : (
            <Button onClick={generate} disabled={generating}>
              <Clapperboard className="size-3.5" />
              {generating ? "Generating…" : "Save prompt & Generate"}
            </Button>
          )}

          {takes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {takes.map((take) => (
                <div key={take.key} className={`flex flex-col gap-1.5 rounded-md border p-1.5 ${take.isSelected ? "border-foreground" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {take.clips.map((clip) => (
                      <video key={clip.id} controls src={clip.url} className="h-24 w-40 rounded object-cover" />
                    ))}
                    <Button size="sm" variant={take.isSelected ? "default" : "outline"} onClick={() => selectTake(take.clips[0].id)} disabled={take.isSelected}>
                      {take.isSelected ? "Selected" : "Use this take"}
                    </Button>
                    <Button size="icon-sm" variant="destructive" aria-label="Delete video take" onClick={() => deleteTake(take)} className="ml-auto">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmDialog}
    </>
  );
}
