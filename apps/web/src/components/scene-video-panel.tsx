"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSelect } from "@/components/model-select";
import { Clapperboard, Save, Sparkles, Trash2 } from "lucide-react";

export interface SceneVideoClipItem {
  id: string;
  url: string;
  isSelected: boolean;
}

// Motion prompt/video prompt/duration are user-written, never AI-drafted —
// same pattern as Scene.narration in scene-voice-panel.tsx. IMAGE_TO_VIDEO
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
  initialVideoClips,
}: {
  sceneId: string;
  mode: "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  hasSelectedImage: boolean;
  initialMotionPrompt: string;
  initialVideoPrompt: string;
  initialVideoDurationSeconds: number | null;
  initialVideoClips: SceneVideoClipItem[];
}) {
  const [motionPrompt, setMotionPrompt] = useState(initialMotionPrompt);
  const [savedMotionPrompt, setSavedMotionPrompt] = useState(initialMotionPrompt);
  const [videoPrompt, setVideoPrompt] = useState(initialVideoPrompt);
  const [savedVideoPrompt, setSavedVideoPrompt] = useState(initialVideoPrompt);
  const [duration, setDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [savedDuration, setSavedDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [videoClips, setVideoClips] = useState(initialVideoClips);
  const [draftModelId, setDraftModelId] = useState("");
  const [drafting, setDrafting] = useState(false);

  const dirty =
    motionPrompt !== savedMotionPrompt || videoPrompt !== savedVideoPrompt || duration !== savedDuration;
  const canGenerate = mode === "TEXT_TO_VIDEO" || hasSelectedImage;

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
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMotionPrompt(motionPrompt);
      setSavedVideoPrompt(videoPrompt);
      setSavedDuration(duration);
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
      const clip: SceneVideoClipItem = await res.json();
      setVideoClips((prev) => [clip, ...prev.map((c) => ({ ...c, isSelected: false }))]);
      toast.success("Video clip generated.");
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

  async function selectClip(assetId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/video/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select clip.");
      return;
    }
    setVideoClips((prev) => prev.map((c) => ({ ...c, isSelected: c.id === assetId })));
  }

  async function deleteClip(assetId: string) {
    if (!confirm("Delete this video clip? This can't be undone.")) return;
    const res = await fetch(`/api/scenes/${sceneId}/video/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete clip.");
      return;
    }
    setVideoClips((prev) => prev.filter((c) => c.id !== assetId));
  }

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
      <div className="flex items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Duration (seconds)</Label>
          <Input
            type="number"
            min={1}
            className="mt-1.5 w-24"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {!canGenerate ? (
        <p className="text-xs text-muted-foreground">Generate and select a scene image above first.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <ModelSelect jobType="VIDEO_GENERATION" value={modelId} onChange={setModelId} />
          <Button size="sm" onClick={generate} disabled={generating || dirty}>
            <Clapperboard className="size-3.5" />
            {generating ? "Generating…" : "Generate Video"}
          </Button>
        </div>
      )}

      {videoClips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {videoClips.map((clip) => (
            <div key={clip.id} className={`flex items-center gap-2 rounded-md border p-1.5 ${clip.isSelected ? "border-foreground" : ""}`}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video controls src={clip.url} className="h-24 w-40 rounded object-cover" />
              <Button size="sm" variant={clip.isSelected ? "default" : "outline"} onClick={() => selectClip(clip.id)} disabled={clip.isSelected}>
                {clip.isSelected ? "Selected" : "Use this clip"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => deleteClip(clip.id)} className="ml-auto text-destructive">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
