"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ModelSelect } from "@/components/model-select";
import type { AudioTake } from "@/components/scene-voice-panel";
import { Wand2, Sparkles, Upload, Trash2, Save } from "lucide-react";

// Two independent slots (Music, SFX) sharing one Audio Plan step. The plan
// (musicPrompt/sfxPrompt) is AI-drafted then user-editable — same pattern as
// Scene.visualModeReason — and lives on the Scene itself so it's reused as
// the actual generation prompt below, not just a one-off suggestion. See
// generateAudioPlan in lib/scene-audio.ts and PHASES.md Phase 7.
export function SceneAudioPanel({
  sceneId,
  initialMusicPrompt,
  initialSfxPrompt,
  initialMusicVolume,
  initialSfxVolume,
  initialMusic,
  initialSfx,
}: {
  sceneId: string;
  initialMusicPrompt: string;
  initialSfxPrompt: string;
  initialMusicVolume: number;
  initialSfxVolume: number;
  initialMusic: AudioTake[];
  initialSfx: AudioTake[];
}) {
  const [musicPrompt, setMusicPrompt] = useState(initialMusicPrompt);
  const [savedMusicPrompt, setSavedMusicPrompt] = useState(initialMusicPrompt);
  const [sfxPrompt, setSfxPrompt] = useState(initialSfxPrompt);
  const [savedSfxPrompt, setSavedSfxPrompt] = useState(initialSfxPrompt);
  const [musicVolume, setMusicVolume] = useState(initialMusicVolume);
  const [savedMusicVolume, setSavedMusicVolume] = useState(initialMusicVolume);
  const [sfxVolume, setSfxVolume] = useState(initialSfxVolume);
  const [savedSfxVolume, setSavedSfxVolume] = useState(initialSfxVolume);
  const [saving, setSaving] = useState(false);
  const [planModelId, setPlanModelId] = useState("");
  const [planning, setPlanning] = useState(false);

  const dirty =
    musicPrompt !== savedMusicPrompt ||
    sfxPrompt !== savedSfxPrompt ||
    musicVolume !== savedMusicVolume ||
    sfxVolume !== savedSfxVolume;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicPrompt: musicPrompt || null,
          sfxPrompt: sfxPrompt || null,
          musicVolume,
          sfxVolume,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMusicPrompt(musicPrompt);
      setSavedSfxPrompt(sfxPrompt);
      setSavedMusicVolume(musicVolume);
      setSavedSfxVolume(sfxVolume);
      toast.success("Audio settings saved.");
    } catch {
      toast.error("Couldn't save audio settings.");
    } finally {
      setSaving(false);
    }
  }

  async function generatePlan() {
    if (!planModelId) {
      toast.error("Pick an Audio Planning model first.");
      return;
    }
    if (dirty) {
      toast.error("Save or discard your edits before generating a new plan.");
      return;
    }
    setPlanning(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/audio-plan/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: planModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Planning failed");
      }
      const plan: { musicPrompt: string | null; sfxPrompt: string | null } = await res.json();
      setMusicPrompt(plan.musicPrompt ?? "");
      setSavedMusicPrompt(plan.musicPrompt ?? "");
      setSfxPrompt(plan.sfxPrompt ?? "");
      setSavedSfxPrompt(plan.sfxPrompt ?? "");
      toast.success("Audio plan generated — review the prompts below before generating audio.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Planning failed.");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <Label className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
          Audio Plan — drafts the two prompts below from this scene (per-scene, not the whole episode at once)
        </Label>
        <ModelSelect jobType="AUDIO_PLANNING" value={planModelId} onChange={setPlanModelId} />
        <Button size="sm" variant="outline" onClick={generatePlan} disabled={planning}>
          <Wand2 className="size-3.5" />
          {planning ? "Planning…" : "Generate Audio Plan"}
        </Button>
      </div>

      <AudioTrackSection
        label="Music"
        sceneId={sceneId}
        basePath="music"
        jobType="MUSIC_GENERATION"
        prompt={musicPrompt}
        onPromptChange={setMusicPrompt}
        volume={musicVolume}
        onVolumeChange={setMusicVolume}
        placeholder="e.g. slow, hopeful piano and strings that build gently — from the Audio Plan above, or written by hand"
        dirty={dirty}
        initialTakes={initialMusic}
      />

      <AudioTrackSection
        label="SFX"
        sceneId={sceneId}
        basePath="sfx"
        jobType="SFX_GENERATION"
        prompt={sfxPrompt}
        onPromptChange={setSfxPrompt}
        volume={sfxVolume}
        onVolumeChange={setSfxVolume}
        placeholder="e.g. footsteps on gravel, a door creaking open"
        dirty={dirty}
        initialTakes={initialSfx}
      />

      <Button size="sm" onClick={save} disabled={!dirty || saving} className="self-start">
        <Save className="size-3.5" />
        {saving ? "Saving…" : "Save Audio Settings"}
      </Button>
    </div>
  );
}

function AudioTrackSection({
  label,
  sceneId,
  basePath,
  jobType,
  prompt,
  onPromptChange,
  volume,
  onVolumeChange,
  placeholder,
  dirty,
  initialTakes,
}: {
  label: string;
  sceneId: string;
  basePath: "music" | "sfx";
  jobType: "MUSIC_GENERATION" | "SFX_GENERATION";
  prompt: string;
  onPromptChange: (v: string) => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  placeholder: string;
  dirty: boolean;
  initialTakes: AudioTake[];
}) {
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [takes, setTakes] = useState(initialTakes);
  const fileRef = useRef<HTMLInputElement>(null);

  async function generate() {
    if (!modelId) {
      toast.error(`Pick a ${label} Generation model first.`);
      return;
    }
    if (dirty) {
      toast.error("Save the audio plan before generating.");
      return;
    }
    if (!prompt.trim()) {
      toast.error(`Write or generate a ${label.toLowerCase()} prompt first.`);
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/${basePath}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const take: AudioTake = await res.json();
      setTakes((prev) => [take, ...prev.map((t) => ({ ...t, isSelected: false }))]);
      toast.success(`${label} generated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function upload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/${basePath}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const take: AudioTake = await res.json();
      setTakes((prev) => [take, ...prev.map((t) => ({ ...t, isSelected: false }))]);
      toast.success(`${label} uploaded.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function select(assetId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/${basePath}/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error(`Couldn't select ${label.toLowerCase()}.`);
      return;
    }
    setTakes((prev) => prev.map((t) => ({ ...t, isSelected: t.id === assetId })));
  }

  async function remove(assetId: string) {
    if (!confirm(`Delete this ${label.toLowerCase()} take? This can't be undone.`)) return;
    const res = await fetch(`/api/scenes/${sceneId}/${basePath}/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(`Couldn't delete ${label.toLowerCase()}.`);
      return;
    }
    setTakes((prev) => prev.filter((t) => t.id !== assetId));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <Label className="text-xs text-muted-foreground">{label} prompt</Label>
      <Textarea rows={2} placeholder={placeholder} value={prompt} onChange={(e) => onPromptChange(e.target.value)} />

      <div className="flex items-center gap-2">
        <Label className="whitespace-nowrap text-xs text-muted-foreground">Volume</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-32"
        />
        <span className="w-10 text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <ModelSelect jobType={jobType} value={modelId} onChange={setModelId} />
        <Button size="sm" variant="outline" onClick={generate} disabled={generating || !prompt.trim()}>
          <Sparkles className="size-3.5" />
          {generating ? "Generating…" : `Generate ${label}`}
        </Button>
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await upload(file);
            e.target.value = "";
          }}
        />
      </div>

      {takes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {takes.map((take) => (
            <div
              key={take.id}
              className={`flex items-center gap-2 rounded-md border p-1.5 ${take.isSelected ? "border-foreground" : ""}`}
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={take.url} className="h-8 flex-1" />
              <Button
                size="sm"
                variant={take.isSelected ? "default" : "outline"}
                onClick={() => select(take.id)}
                disabled={take.isSelected}
              >
                {take.isSelected ? "Selected" : "Use this"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => remove(take.id)} className="text-destructive">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
