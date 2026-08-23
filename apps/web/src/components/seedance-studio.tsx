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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ModelSelect, type ModelOption } from "@/components/model-select";
import type { SceneVideoClipItem } from "@/components/scene-video-panel";
import { parseVideoModelConfig } from "@/lib/video-model-config";
import { Clapperboard, Trash2 } from "lucide-react";

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

interface Take {
  key: string;
  clips: SceneVideoClipItem[];
  isSelected: boolean;
}

// Same batching logic as scene-video-panel.tsx's groupIntoTakes/clipLabel —
// duplicated rather than imported since those are private to that file and
// this studio's gallery is intentionally independent of it.
function groupIntoTakes(clips: SceneVideoClipItem[]): Take[] {
  const byBatch = new Map<string, SceneVideoClipItem[]>();
  const takes: Take[] = [];
  for (const clip of clips) {
    if (!clip.batchId) {
      takes.push({ key: clip.id, clips: [clip], isSelected: clip.isSelected });
      continue;
    }
    const existing = byBatch.get(clip.batchId);
    if (existing) {
      existing.push(clip);
    } else {
      const group = [clip];
      byBatch.set(clip.batchId, group);
      takes.push({ key: clip.batchId, clips: group, isSelected: clip.isSelected });
    }
  }
  for (const take of takes) take.clips.sort((a, b) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0));
  return takes;
}

interface PromptBuilderFields {
  subject: string;
  action: string;
  camera: string;
  style: string;
  beatHook: string;
  beatDevelopment: string;
  beatEscalation: string;
  beatResolution: string;
  ending: string;
}

const EMPTY_FIELDS: PromptBuilderFields = {
  subject: "",
  action: "",
  camera: "",
  style: "",
  beatHook: "",
  beatDevelopment: "",
  beatEscalation: "",
  beatResolution: "",
  ending: "",
};

// Seedance has no separate timestamp field — timing only works as in-prompt
// text (per ByteDance/platform guidance: "0-5s: ...", read as planning aids,
// not frame-exact contracts), so beats are appended straight into the flat
// prompt string the backend already expects.
function assemblePrompt(f: PromptBuilderFields): string {
  const lines: string[] = [];
  const core = [f.subject.trim(), f.action.trim()].filter(Boolean).join(" ");
  if (core) lines.push(core);
  if (f.camera.trim()) lines.push(`Camera: ${f.camera.trim()}.`);
  if (f.style.trim()) lines.push(`Style: ${f.style.trim()}.`);
  const beats = [
    f.beatHook.trim() && `0-5s: ${f.beatHook.trim()}.`,
    f.beatDevelopment.trim() && `5-16s: ${f.beatDevelopment.trim()}.`,
    f.beatEscalation.trim() && `16-25s: ${f.beatEscalation.trim()}.`,
    f.beatResolution.trim() && `25-30s: ${f.beatResolution.trim()}.`,
  ].filter((b): b is string => Boolean(b));
  if (beats.length) lines.push(`Timeline — ${beats.join(" ")}`);
  if (f.ending.trim()) lines.push(`End on: ${f.ending.trim()}.`);
  return lines.join("\n\n");
}

const FAILURE_MODES: { symptom: string; fix: string }[] = [
  { symptom: "Character/outfit drifts mid-clip", fix: "Keep the scene to 8 or fewer identifiable people; lock “must not change” details in Style." },
  { symptom: "Camera wanders aimlessly", fix: "Name one explicit move in Camera instead of leaving it blank." },
  { symptom: "Reactions/events feel jumbled", fix: "Fill in the timed beats so cause is stated before effect." },
  { symptom: "Clip trails off with no resolution", fix: "Fill in “Ending” — a held frame, pull-back, or specific gesture." },
];

export function SeedanceStudio({ scenes: initialScenes }: { scenes: SeedanceSceneOption[] }) {
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
      <p className="text-sm text-muted-foreground">
        No scenes are set to Image → Video or Text → Video yet. Set a scene&apos;s Visual Mode on the Scenes page first.
      </p>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symptom</TableHead>
                <TableHead>Likely fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FAILURE_MODES.map((row) => (
                <TableRow key={row.symptom}>
                  <TableCell className="whitespace-normal text-sm">{row.symptom}</TableCell>
                  <TableCell className="whitespace-normal text-sm text-muted-foreground">{row.fix}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
  const [fields, setFields] = useState<PromptBuilderFields>(EMPTY_FIELDS);
  const [duration, setDuration] = useState(scene.videoDurationSeconds?.toString() ?? "");
  const [resolution, setResolution] = useState(scene.videoResolution ?? "");
  const [generateAudio, setGenerateAudio] = useState(scene.videoGenerateAudio);
  const [includeCastReferences, setIncludeCastReferences] = useState(true);
  const [generating, setGenerating] = useState(false);

  const assembled = useMemo(() => assemblePrompt(fields), [fields]);
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
    if (!confirm("Delete this take? This can't be undone.")) return;
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
          <p className="text-xs text-muted-foreground">
            Direct the scene, don&apos;t describe an image — Subject → Action → Camera → Style, in playback order.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Textarea
                rows={2}
                placeholder="e.g. A woman in a red coat"
                value={fields.subject}
                onChange={(e) => setFields((f) => ({ ...f, subject: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Action</Label>
              <Textarea
                rows={2}
                placeholder="e.g. walks briskly through falling snow, glancing over her shoulder"
                value={fields.action}
                onChange={(e) => setFields((f) => ({ ...f, action: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Camera</Label>
              <Input
                placeholder="e.g. slow dolly-in from a low angle"
                value={fields.camera}
                onChange={(e) => setFields((f) => ({ ...f, camera: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Style</Label>
              <Input
                placeholder="e.g. cinematic, moody blue-hour lighting, shallow depth of field"
                value={fields.style}
                onChange={(e) => setFields((f) => ({ ...f, style: e.target.value }))}
                className="mt-1.5"
              />
            </div>
          </div>

          <details className="rounded-md border p-2.5">
            <summary className="cursor-pointer text-sm font-medium">Timed beats (optional — for longer clips)</summary>
            <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Hook (0–5s)</Label>
                <Textarea rows={2} value={fields.beatHook} onChange={(e) => setFields((f) => ({ ...f, beatHook: e.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Development (5–16s)</Label>
                <Textarea rows={2} value={fields.beatDevelopment} onChange={(e) => setFields((f) => ({ ...f, beatDevelopment: e.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Escalation / proof (16–25s)</Label>
                <Textarea rows={2} value={fields.beatEscalation} onChange={(e) => setFields((f) => ({ ...f, beatEscalation: e.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Resolution (25–30s)</Label>
                <Textarea rows={2} value={fields.beatResolution} onChange={(e) => setFields((f) => ({ ...f, beatResolution: e.target.value }))} className="mt-1.5" />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Planning aids, not frame-exact contracts — Seedance has no separate timestamp field, so these are written into the prompt as
              plain timed stage directions.
            </p>
          </details>

          <div>
            <Label className="text-xs text-muted-foreground">Ending (always direct how it ends)</Label>
            <Input
              placeholder="e.g. she stops, turns to face camera, hold on her expression"
              value={fields.ending}
              onChange={(e) => setFields((f) => ({ ...f, ending: e.target.value }))}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Assembled prompt (what actually gets sent)</Label>
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2.5 text-xs">
              {assembled || "(blank — falls back to the scene description at generation time)"}
            </pre>
          </div>

          {savedPrompt && (
            <p className="text-xs text-muted-foreground">
              Currently saved on this scene: <span className="italic">&quot;{savedPrompt}&quot;</span> — generating below replaces it with the
              assembled prompt above.
            </p>
          )}
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
                    <Button size="icon-sm" variant="ghost" onClick={() => deleteTake(take)} className="ml-auto text-destructive">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
