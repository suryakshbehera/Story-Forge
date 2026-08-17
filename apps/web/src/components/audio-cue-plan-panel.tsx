"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ModelSelect } from "@/components/model-select";
import { Wand2, Check, Trash2 } from "lucide-react";

interface DialogueLineDraft {
  characterName: string;
  text: string;
}

interface CuePlanEntry {
  sceneId: string;
  order: number;
  title: string | null;
  startSeconds: number;
  durationSeconds: number;
  narration: string;
  dialogueLines: DialogueLineDraft[];
  existingDialogueCount: number;
  musicPrompt: string;
  sfxPrompt: string;
}

// Phase 11 — drafts a whole-story/episode cue plan by watching the fully
// assembled silent picture (assembleSilentPicture), then lets the producer
// review/edit every scene's proposed narration/dialogue/music/sfx before
// applying it into the same Scene.narration/DialogueLine/musicPrompt/
// sfxPrompt fields the Voice/Audio panels below already read from — this
// panel doesn't generate any audio itself, it only improves what feeds
// those existing generation steps. Positioned above Final Assembly: draft →
// review → apply → (use the Voice/Audio panels per scene) → assemble.
export function AudioCuePlanPanel({ parentType, parentId }: { parentType: "story" | "episode"; parentId: string }) {
  const [modelId, setModelId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [entries, setEntries] = useState<CuePlanEntry[] | null>(null);

  const base = parentType === "story" ? `/api/stories/${parentId}/audio-cue-plan` : `/api/episodes/${parentId}/audio-cue-plan`;

  async function draft() {
    if (!modelId) {
      toast.error("Pick an Audio Cue Planning model first.");
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
      const { entries: drafted }: { entries: CuePlanEntry[] } = await res.json();
      setEntries(drafted);
      toast.success("Cue plan drafted — review each scene below before applying.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }

  function updateEntry(sceneId: string, patch: Partial<CuePlanEntry>) {
    setEntries((prev) => prev?.map((e) => (e.sceneId === sceneId ? { ...e, ...patch } : e)) ?? null);
  }

  function removeDialogueLine(sceneId: string, index: number) {
    setEntries(
      (prev) =>
        prev?.map((e) => (e.sceneId === sceneId ? { ...e, dialogueLines: e.dialogueLines.filter((_, i) => i !== index) } : e)) ?? null
    );
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
            narration: e.narration,
            dialogueLines: e.dialogueLines,
            musicPrompt: e.musicPrompt,
            sfxPrompt: e.sfxPrompt,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Apply failed");
      }
      toast.success("Cue plan applied. Reloading to show it in the scene panels below…");
      // The Voice/Audio panels per scene are separate client components that
      // only read their initial value from server props — same reasoning
      // story-chat-panel.tsx's "Add to Story/Episode Summary" reload uses.
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Watches the fully assembled, still-silent picture and proposes narration, dialogue, music, and sfx per scene, grounded in what
        actually happens on screen — review and edit below, then apply. Replaces planning each scene&apos;s music/sfx blind, one at a
        time.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <ModelSelect jobType="AUDIO_CUE_PLANNING" value={modelId} onChange={setModelId} />
        <Button size="sm" onClick={draft} disabled={drafting}>
          <Wand2 className="size-3.5" />
          {drafting ? "Drafting…" : "Draft Cue Plan"}
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
                {entry.title ? ` "${entry.title}"` : ""} — {entry.startSeconds.toFixed(1)}s–{(entry.startSeconds + entry.durationSeconds).toFixed(1)}s
              </div>

              <Label className="text-xs text-muted-foreground">Narration</Label>
              <Textarea
                rows={2}
                value={entry.narration}
                onChange={(e) => updateEntry(entry.sceneId, { narration: e.target.value })}
              />

              <Label className="text-xs text-muted-foreground">
                Dialogue{entry.existingDialogueCount > 0 ? " (scene already has dialogue — this proposal will be ignored on apply)" : ""}
              </Label>
              {entry.dialogueLines.length === 0 ? (
                <p className="text-xs text-muted-foreground">(none proposed)</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {entry.dialogueLines.map((line, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="mt-1.5 w-24 shrink-0 truncate text-xs text-muted-foreground">{line.characterName}</span>
                      <Textarea
                        rows={1}
                        value={line.text}
                        onChange={(e) => {
                          const dialogueLines = entry.dialogueLines.map((l, li) => (li === i ? { ...l, text: e.target.value } : l));
                          updateEntry(entry.sceneId, { dialogueLines });
                        }}
                      />
                      <Button size="icon-sm" variant="ghost" onClick={() => removeDialogueLine(entry.sceneId, i)} className="text-destructive">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Music prompt</Label>
                  <Textarea rows={2} value={entry.musicPrompt} onChange={(e) => updateEntry(entry.sceneId, { musicPrompt: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">SFX prompt</Label>
                  <Textarea rows={2} value={entry.sfxPrompt} onChange={(e) => updateEntry(entry.sceneId, { sfxPrompt: e.target.value })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
