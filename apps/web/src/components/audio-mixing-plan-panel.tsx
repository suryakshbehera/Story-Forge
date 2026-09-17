"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ModelSelect } from "@/components/model-select";
import { SlidersHorizontal, Check } from "lucide-react";

interface SceneMixState {
  musicVolume: number;
  sfxVolume: number;
  duckMusicUnderDialogue: boolean;
  musicFadeInSeconds: number | null;
  musicFadeOutSeconds: number | null;
  hasVoice: boolean;
  hasMusic: boolean;
  hasSfx: boolean;
}

interface MixPlanEntry {
  sceneId: string;
  order: number;
  title: string | null;
  startSeconds: number;
  durationSeconds: number;
  current: SceneMixState;
  musicVolume: number;
  sfxVolume: number;
  duckMusicUnderDialogue: boolean;
  musicFadeInSeconds: number | null;
  musicFadeOutSeconds: number | null;
  reason: string;
}

function formatFade(seconds: number | null): string {
  return seconds != null && seconds > 0 ? `${seconds}s` : "none";
}

// Renders "0.25 → 0.12"-style before/after only when the proposal actually
// differs, so a long episode's unchanged scenes read as unchanged at a glance
// instead of every row looking like a pending edit.
function Delta({ from, to }: { from: string; to: string }) {
  if (from === to) return <span className="text-xs text-muted-foreground">unchanged ({from})</span>;
  return (
    <span className="text-xs text-muted-foreground">
      was {from} → <span className="font-medium text-foreground">{to}</span>
    </span>
  );
}

// The Sound Engineer step (AUDIO_MIXING_PLANNING). Unlike AudioCuePlanPanel —
// which watches the SILENT picture and proposes what each scene should
// contain — this watches the selected FINAL, already-mixed render and
// proposes how those existing layers should sit together: music/sfx levels,
// whether music ducks under speech, and music fades at scene boundaries.
//
// Nothing here regenerates audio, and applying a plan doesn't change the
// render the user just watched. The loop is deliberately explicit:
// Final Assembly → draft a mix plan → review/edit → apply → re-run Final
// Assembly to hear it. That's why this panel sits after the assembly step
// rather than before it — it has nothing to listen to until one exists.
export function AudioMixingPlanPanel({
  parentType,
  parentId,
  hasSelectedFinalVideo,
}: {
  parentType: "story" | "episode";
  parentId: string;
  hasSelectedFinalVideo: boolean;
}) {
  const [modelId, setModelId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [entries, setEntries] = useState<MixPlanEntry[] | null>(null);

  const base =
    parentType === "story" ? `/api/stories/${parentId}/audio-mixing-plan` : `/api/episodes/${parentId}/audio-mixing-plan`;

  async function draft() {
    if (!hasSelectedFinalVideo) {
      toast.error("Assemble and select a final video above first.");
      return;
    }
    if (!modelId) {
      toast.error("Pick an Audio Mixing model first.");
      return;
    }
    setDrafting(true);
    try {
      const res = await fetch(`${base}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Drafting failed");
      }
      const { entries: drafted }: { entries: MixPlanEntry[] } = await res.json();
      setEntries(drafted);
      toast.success("Mix plan drafted — review each scene below before applying.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }

  function updateEntry(sceneId: string, patch: Partial<MixPlanEntry>) {
    setEntries((prev) => prev?.map((e) => (e.sceneId === sceneId ? { ...e, ...patch } : e)) ?? null);
  }

  // "" and anything unparseable both mean "no fade" — the field is optional
  // by nature, so clearing it must not become NaN on the way to the API.
  function parseFadeInput(raw: string): number | null {
    if (raw.trim() === "") return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  async function applyAll() {
    if (!entries || entries.length === 0) return;
    setApplying(true);
    try {
      const res = await fetch(`${base}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e) => ({
            sceneId: e.sceneId,
            musicVolume: e.musicVolume,
            sfxVolume: e.sfxVolume,
            duckMusicUnderDialogue: e.duckMusicUnderDialogue,
            musicFadeInSeconds: e.musicFadeInSeconds,
            musicFadeOutSeconds: e.musicFadeOutSeconds,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Apply failed");
      }
      toast.success("Mix applied. Re-run Final Assembly above to hear it. Reloading…");
      // The per-scene Audio panels read their volumes from server props only,
      // same as AudioCuePlanPanel's reload for the same reason.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Listens to the assembled final video above — the actual mix, not the silent picture — and proposes per-scene
        levels, music ducking under dialogue, and music fades at scene boundaries. Review and edit below, apply, then
        re-run Final Assembly to hear the new mix. No audio is regenerated.
      </p>
      {!hasSelectedFinalVideo && (
        <p className="text-xs text-muted-foreground">Assemble and select a final video above first.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <ModelSelect jobType="AUDIO_MIXING_PLANNING" value={modelId} onChange={setModelId} />
        <Button size="sm" onClick={draft} disabled={drafting || !hasSelectedFinalVideo}>
          <SlidersHorizontal className="size-3.5" />
          {drafting ? "Listening…" : "Review the Mix"}
        </Button>
        {entries && entries.length > 0 && (
          <Button size="sm" variant="outline" onClick={applyAll} disabled={applying}>
            <Check className="size-3.5" />
            {applying ? "Applying…" : "Apply All"}
          </Button>
        )}
      </div>

      {entries && entries.length === 0 && <p className="text-xs text-muted-foreground">No scenes came back — nothing to review.</p>}

      {entries && entries.length > 0 && (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.sceneId} className="flex flex-col gap-2 rounded-md border p-2.5">
              <div className="text-xs font-medium text-muted-foreground">
                #{entry.order}
                {entry.title ? ` "${entry.title}"` : ""} — {entry.startSeconds.toFixed(1)}s–
                {(entry.startSeconds + entry.durationSeconds).toFixed(1)}s
                {" · "}
                {[entry.current.hasVoice && "voice", entry.current.hasMusic && "music", entry.current.hasSfx && "sfx"]
                  .filter(Boolean)
                  .join(" + ") || "silent"}
              </div>

              {entry.reason && <p className="text-xs text-muted-foreground">{entry.reason}</p>}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Music volume</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={entry.musicVolume}
                      onChange={(e) => updateEntry(entry.sceneId, { musicVolume: Number(e.target.value) })}
                      className="w-32"
                    />
                    <Delta from={entry.current.musicVolume.toFixed(2)} to={entry.musicVolume.toFixed(2)} />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">SFX volume</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={entry.sfxVolume}
                      onChange={(e) => updateEntry(entry.sceneId, { sfxVolume: Number(e.target.value) })}
                      className="w-32"
                    />
                    <Delta from={entry.current.sfxVolume.toFixed(2)} to={entry.sfxVolume.toFixed(2)} />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  id={`duck-${entry.sceneId}`}
                  checked={entry.duckMusicUnderDialogue}
                  onCheckedChange={(checked) => updateEntry(entry.sceneId, { duckMusicUnderDialogue: checked })}
                />
                <Label htmlFor={`duck-${entry.sceneId}`} className="text-xs text-muted-foreground">
                  Duck music under dialogue
                </Label>
                <Delta
                  from={entry.current.duckMusicUnderDialogue ? "on" : "off"}
                  to={entry.duckMusicUnderDialogue ? "on" : "off"}
                />
                {entry.duckMusicUnderDialogue && !entry.current.hasVoice && (
                  <span className="text-xs text-muted-foreground">(no voice in this scene — this will have no effect)</span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Music fade in (seconds, blank = none)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      className="w-24"
                      value={entry.musicFadeInSeconds ?? ""}
                      onChange={(e) => updateEntry(entry.sceneId, { musicFadeInSeconds: parseFadeInput(e.target.value) })}
                    />
                    <Delta from={formatFade(entry.current.musicFadeInSeconds)} to={formatFade(entry.musicFadeInSeconds)} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Music fade out (seconds, blank = none)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      className="w-24"
                      value={entry.musicFadeOutSeconds ?? ""}
                      onChange={(e) => updateEntry(entry.sceneId, { musicFadeOutSeconds: parseFadeInput(e.target.value) })}
                    />
                    <Delta from={formatFade(entry.current.musicFadeOutSeconds)} to={formatFade(entry.musicFadeOutSeconds)} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
