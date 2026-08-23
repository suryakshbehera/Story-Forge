"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelect, type ModelOption } from "@/components/model-select";
import { Clapperboard, Save, Sparkles, Trash2 } from "lucide-react";
import { parseVideoModelConfig } from "@/lib/video-model-config";
import { planVideoSegments } from "@/lib/video-segmentation";

export interface SceneVideoClipItem {
  id: string;
  url: string;
  isSelected: boolean;
  batchId?: string | null;
  segmentOrder?: number | null;
}

interface VideoTake {
  key: string;
  clips: SceneVideoClipItem[];
  isSelected: boolean;
}

function groupIntoTakes(clips: SceneVideoClipItem[]): VideoTake[] {
  const byBatch = new Map<string, SceneVideoClipItem[]>();
  const takes: VideoTake[] = [];
  for (const clip of clips) {
    if (!clip.batchId) {
      takes.push({ key: clip.id, clips: [clip], isSelected: clip.isSelected });
      continue;
    }
    const existing = byBatch.get(clip.batchId);
    if (existing) {
      existing.push(clip);
    } else {
      const group: SceneVideoClipItem[] = [clip];
      byBatch.set(clip.batchId, group);
      takes.push({ key: clip.batchId, clips: group, isSelected: clip.isSelected });
    }
  }
  for (const take of takes) {
    take.clips.sort((a, b) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0));
  }
  return takes;
}

// Motion prompt/video prompt are user-written, never AI-drafted — same
// pattern as Scene.narration in scene-voice-panel.tsx. Duration has an
// optional AI suggestion (recommendVideoDuration in lib/scene-video.ts) but
// stays a plain editable field otherwise — the AI only proposes a value into
// it, same "draft, don't auto-apply" idiom as the motion prompt draft button
// below. IMAGE_TO_VIDEO
// generation always reads the *saved* scene image (isSelected) as the
// starting frame; this panel never lets the user override that per-call.
// TEXT_TO_VIDEO has no source image at all — motionPrompt and videoPrompt
// are kept as separate fields (see Scene.videoPrompt in schema.prisma) since
// one describes motion layered on an existing image and the other has to
// carry the whole shot on its own.
export function SceneVideoPanel({
  sceneId,
  mode,
  hasSelectedImage,
  initialMotionPrompt,
  initialVideoPrompt,
  initialVideoDurationSeconds,
  initialVideoResolution,
  initialVideoGenerateAudio,
  initialVideoClips,
}: {
  sceneId: string;
  mode: "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  hasSelectedImage: boolean;
  initialMotionPrompt: string;
  initialVideoPrompt: string;
  initialVideoDurationSeconds: number | null;
  initialVideoResolution: string | null;
  initialVideoGenerateAudio: boolean;
  initialVideoClips: SceneVideoClipItem[];
}) {
  const [motionPrompt, setMotionPrompt] = useState(initialMotionPrompt);
  const [savedMotionPrompt, setSavedMotionPrompt] = useState(initialMotionPrompt);
  const [videoPrompt, setVideoPrompt] = useState(initialVideoPrompt);
  const [savedVideoPrompt, setSavedVideoPrompt] = useState(initialVideoPrompt);
  const [duration, setDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [savedDuration, setSavedDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [resolution, setResolution] = useState(initialVideoResolution ?? "");
  const [savedResolution, setSavedResolution] = useState(initialVideoResolution ?? "");
  const [generateAudio, setGenerateAudio] = useState(initialVideoGenerateAudio);
  const [savedGenerateAudio, setSavedGenerateAudio] = useState(initialVideoGenerateAudio);
  const [saving, setSaving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [videoClips, setVideoClips] = useState(initialVideoClips);
  const [draftModelId, setDraftModelId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState<number | null>(null);
  const [durationModelId, setDurationModelId] = useState("");
  const [suggestingDuration, setSuggestingDuration] = useState(false);
  const [durationReason, setDurationReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scenes/${sceneId}/voice-duration`)
      .then((res) => res.json())
      .then((data: { seconds: number | null }) => {
        if (!cancelled) setVoiceDurationSeconds(data.seconds);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const dirty =
    motionPrompt !== savedMotionPrompt ||
    videoPrompt !== savedVideoPrompt ||
    duration !== savedDuration ||
    resolution !== savedResolution ||
    generateAudio !== savedGenerateAudio;
  const canGenerate = mode === "TEXT_TO_VIDEO" || hasSelectedImage;

  const selectedModel = models.find((m) => m.id === modelId);
  const modelConfig = parseVideoModelConfig(selectedModel?.config);
  const targetDuration = duration ? Number(duration) : voiceDurationSeconds;
  const segmentPlan = useMemo(
    () => (targetDuration && targetDuration > 0 ? planVideoSegments(targetDuration, modelConfig) : null),
    [targetDuration, modelConfig]
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motionPrompt: motionPrompt || null,
          videoPrompt: videoPrompt || null,
          videoDurationSeconds: duration ? Number(duration) : null,
          videoResolution: resolution || null,
          videoGenerateAudio: generateAudio,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMotionPrompt(motionPrompt);
      setSavedVideoPrompt(videoPrompt);
      setSavedDuration(duration);
      setSavedResolution(resolution);
      setSavedGenerateAudio(generateAudio);
      toast.success("Motion settings saved.");
    } catch {
      toast.error("Couldn't save motion settings.");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (!modelId) {
      toast.error("Pick a video generation model first.");
      return;
    }
    if (dirty) {
      toast.error("Save the motion settings before generating.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const clips: SceneVideoClipItem[] = await res.json();
      setVideoClips((prev) => [...clips, ...prev.map((c) => ({ ...c, isSelected: false }))]);
      toast.success(clips.length > 1 ? `${clips.length} video segments generated.` : "Video clip generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function draftPrompt() {
    if (!draftModelId) {
      toast.error("Pick a motion prompt drafting model first.");
      return;
    }
    setDrafting(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/motion-prompt/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: draftModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Drafting failed");
      }
      const { motionPrompt: draft } = await res.json();
      setMotionPrompt(draft);
      toast.success("Motion prompt drafted — review and save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }

  async function suggestDuration() {
    if (!durationModelId) {
      toast.error("Pick a duration recommendation model first.");
      return;
    }
    setSuggestingDuration(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video-duration/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: durationModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Suggestion failed");
      }
      const { durationSeconds, reason }: { durationSeconds: number; reason: string } = await res.json();
      setDuration(durationSeconds.toString());
      setDurationReason(reason);
      toast.success(`AI recommends ~${durationSeconds}s — review and save.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed.");
    } finally {
      setSuggestingDuration(false);
    }
  }

  async function selectTake(clipId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/video/${clipId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select this take.");
      return;
    }
    const selectedBatch: SceneVideoClipItem[] = await res.json();
    const selectedIds = new Set(selectedBatch.map((c) => c.id));
    setVideoClips((prev) => prev.map((c) => ({ ...c, isSelected: selectedIds.has(c.id) })));
  }

  async function deleteTake(take: VideoTake) {
    if (!confirm("Delete this take? This can't be undone.")) return;
    const res = await fetch(`/api/scenes/${sceneId}/video/${take.clips[0].id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    const idsToRemove = new Set(take.clips.map((c) => c.id));
    setVideoClips((prev) => prev.filter((c) => !idsToRemove.has(c.id)));
  }

  const takes = groupIntoTakes(videoClips);
  const resolutionOptions = modelConfig?.resolutions ?? [];

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {mode === "IMAGE_TO_VIDEO" ? (
        <div>
          <Label className="text-xs text-muted-foreground">Motion prompt (camera/motion direction)</Label>
          <Textarea
            rows={2}
            placeholder="e.g. slow push in, hair moves in the wind — falls back to the scene description if left blank"
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
            className="mt-1.5"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ModelSelect jobType="MOTION_PROMPT_DRAFTING" value={draftModelId} onChange={setDraftModelId} />
            <Button
              size="sm"
              variant="outline"
              onClick={draftPrompt}
              disabled={drafting || !hasSelectedImage}
              title={!hasSelectedImage ? "Select a first-shot image above first" : undefined}
            >
              <Sparkles className="size-3.5" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Reads the previous scene&apos;s generated clip (video + audio) and this scene&apos;s selected image to draft
            a continuity-aware motion prompt.
          </p>
        </div>
      ) : (
        <div>
          <Label className="text-xs text-muted-foreground">Video prompt (describes the whole shot, no source image)</Label>
          <Textarea
            rows={2}
            placeholder="e.g. a lone figure walks through a neon-lit alley in the rain — falls back to the scene description if left blank"
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            className="mt-1.5"
          />
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Duration (seconds, optional override)</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              type="number"
              min={1}
              className="w-24"
              placeholder="auto"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                setDurationReason("");
              }}
            />
            <ModelSelect jobType="DURATION_RECOMMENDATION" value={durationModelId} onChange={setDurationModelId} />
            <Button size="sm" variant="outline" onClick={suggestDuration} disabled={suggestingDuration}>
              <Sparkles className="size-3.5" />
              {suggestingDuration ? "Suggesting…" : "Suggest with AI"}
            </Button>
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
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {durationReason && <p className="text-xs text-muted-foreground">AI: {durationReason}</p>}

      {segmentPlan && (
        <p className="text-xs text-muted-foreground">
          Suggested: {segmentPlan.durations.length} clip{segmentPlan.durations.length > 1 ? "s" : ""} (
          {segmentPlan.durations.map((d) => `${Math.round(d * 10) / 10}s`).join(" + ")} = {Math.round(segmentPlan.totalSeconds * 10) / 10}s)
          {selectedModel ? ` for ${selectedModel.displayName}` : ""}, based on{" "}
          {duration ? "the duration above" : `~${Math.round((voiceDurationSeconds ?? 0) * 10) / 10}s of scene audio`}.
        </p>
      )}

      {!canGenerate ? (
        <p className="text-xs text-muted-foreground">Generate and select a scene image above first.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <ModelSelect jobType="VIDEO_GENERATION" value={modelId} onChange={setModelId} onModelsChange={setModels} />
          <Button size="sm" onClick={generate} disabled={generating || dirty}>
            <Clapperboard className="size-3.5" />
            {generating ? "Generating…" : "Generate Video"}
          </Button>
        </div>
      )}

      {takes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {takes.map((take) => (
            <div key={take.key} className={`flex flex-col gap-1.5 rounded-md border p-1.5 ${take.isSelected ? "border-foreground" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                {take.clips.map((clip, i) => (
                  <video key={clip.id} controls src={clip.url} className="h-24 w-40 rounded object-cover" title={take.clips.length > 1 ? `Segment ${i + 1}` : undefined} />
                ))}
                <Button size="sm" variant={take.isSelected ? "default" : "outline"} onClick={() => selectTake(take.clips[0].id)} disabled={take.isSelected}>
                  {take.isSelected ? "Selected" : "Use this take"}
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => deleteTake(take)} className="ml-auto text-destructive">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {take.clips.length > 1 && (
                <p className="text-xs text-muted-foreground">{take.clips.length} frame-chained segments, in order.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
