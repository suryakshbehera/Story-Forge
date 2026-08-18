"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelSelect } from "@/components/model-select";
import { Mic, Plus, Save, Trash2, ChevronUp, ChevronDown, Wand2 } from "lucide-react";

export interface AudioTake {
  id: string;
  url: string;
  isSelected: boolean;
}

export interface DialogueLineItem {
  id: string;
  order: number;
  text: string;
  // Phase 8 — "direction": AI-drafted (via DIALOGUE_DIRECTION, one call per
  // scene), then user-editable, passed through to TTS as instructions/speed.
  deliveryNotes: string | null;
  speed: number | null;
  character: { id: string; name: string; voiceName: string | null };
  audio: AudioTake[];
}

export interface VoiceCharacterOption {
  id: string;
  name: string;
  voiceName: string | null;
}

// Voice is always resolved server-side from Project.narratorVoiceName
// (narration) or Character.voiceName (dialogue) — never typed per scene or
// per line — so the same narrator/character sounds the same in every scene
// of a story. This panel only ever displays those values; it never collects
// a voice string from the user. See lib/voice.ts.
export function SceneVoicePanel({
  sceneId,
  characters,
  narratorVoiceName,
  initialNarration,
  initialNarrationDeliveryNotes,
  initialNarrationSpeed,
  initialNarrationAudio,
  initialDialogueLines,
}: {
  sceneId: string;
  characters: VoiceCharacterOption[];
  narratorVoiceName: string | null;
  initialNarration: string;
  initialNarrationDeliveryNotes: string | null;
  initialNarrationSpeed: number | null;
  initialNarrationAudio: AudioTake[];
  initialDialogueLines: DialogueLineItem[];
}) {
  const [narration, setNarration] = useState(initialNarration);
  const [savedNarration, setSavedNarration] = useState(initialNarration);
  const [narrationDeliveryNotes, setNarrationDeliveryNotes] = useState(initialNarrationDeliveryNotes ?? "");
  const [savedNarrationDeliveryNotes, setSavedNarrationDeliveryNotes] = useState(initialNarrationDeliveryNotes ?? "");
  const [narrationSpeed, setNarrationSpeed] = useState(initialNarrationSpeed?.toString() ?? "");
  const [savedNarrationSpeed, setSavedNarrationSpeed] = useState(initialNarrationSpeed?.toString() ?? "");
  const [savingNarration, setSavingNarration] = useState(false);
  const [narrationAudio, setNarrationAudio] = useState(initialNarrationAudio);
  const [narrationModelId, setNarrationModelId] = useState("");
  const [generatingNarration, setGeneratingNarration] = useState(false);
  const [narrationDirectionModelId, setNarrationDirectionModelId] = useState("");
  const [directingNarration, setDirectingNarration] = useState(false);

  const narrationDirty =
    narration !== savedNarration ||
    narrationDeliveryNotes !== savedNarrationDeliveryNotes ||
    narrationSpeed !== savedNarrationSpeed;

  const [dialogueLines, setDialogueLines] = useState(initialDialogueLines);
  const [directionModelId, setDirectionModelId] = useState("");
  const [directing, setDirecting] = useState(false);
  const [scriptModelId, setScriptModelId] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function saveNarration() {
    setSavingNarration(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narration: narration || null,
          narrationDeliveryNotes: narrationDeliveryNotes || null,
          narrationSpeed: narrationSpeed ? Number(narrationSpeed) : null,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedNarration(narration);
      setSavedNarrationDeliveryNotes(narrationDeliveryNotes);
      setSavedNarrationSpeed(narrationSpeed);
      toast.success("Narration script saved.");
    } catch {
      toast.error("Couldn't save narration script.");
    } finally {
      setSavingNarration(false);
    }
  }

  async function directNarration() {
    if (!narrationDirectionModelId) {
      toast.error("Pick a Narration Direction model first.");
      return;
    }
    setDirectingNarration(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/narration-direction/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: narrationDirectionModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Direction failed");
      }
      const direction: { narrationDeliveryNotes: string | null; narrationSpeed: number | null } = await res.json();
      setNarrationDeliveryNotes(direction.narrationDeliveryNotes ?? "");
      setSavedNarrationDeliveryNotes(direction.narrationDeliveryNotes ?? "");
      setNarrationSpeed(direction.narrationSpeed?.toString() ?? "");
      setSavedNarrationSpeed(direction.narrationSpeed?.toString() ?? "");
      toast.success("Narration directed — review the delivery below.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Direction failed.");
    } finally {
      setDirectingNarration(false);
    }
  }

  async function generateNarration() {
    if (!narrationModelId) {
      toast.error("Pick a voice model first.");
      return;
    }
    if (narrationDirty) {
      toast.error("Save the narration script before generating audio.");
      return;
    }
    setGeneratingNarration(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/narration/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: narrationModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const take: AudioTake = await res.json();
      setNarrationAudio((prev) => [take, ...prev.map((t) => ({ ...t, isSelected: false }))]);
      toast.success("Narration audio generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGeneratingNarration(false);
    }
  }

  async function selectNarrationTake(assetId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/narration/${assetId}`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select take.");
      return;
    }
    setNarrationAudio((prev) => prev.map((t) => ({ ...t, isSelected: t.id === assetId })));
  }

  async function deleteNarrationTake(assetId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/narration/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    setNarrationAudio((prev) => prev.filter((t) => t.id !== assetId));
  }

  async function addDialogueLine(characterId: string, text: string) {
    const res = await fetch(`/api/scenes/${sceneId}/dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, text }),
    });
    if (!res.ok) {
      toast.error("Couldn't add dialogue line.");
      return;
    }
    const line: DialogueLineItem = await res.json();
    setDialogueLines((prev) => [...prev, line].sort((a, b) => a.order - b.order));
  }

  function updateLineLocal(line: DialogueLineItem) {
    setDialogueLines((prev) => prev.map((l) => (l.id === line.id ? line : l)).sort((a, b) => a.order - b.order));
  }

  function mergeLinesLocal(updated: DialogueLineItem[]) {
    setDialogueLines((prev) => {
      const byId = new Map(prev.map((l) => [l.id, l]));
      for (const u of updated) byId.set(u.id, u);
      return Array.from(byId.values()).sort((a, b) => a.order - b.order);
    });
  }

  function removeLineLocal(id: string, order: number) {
    setDialogueLines((prev) =>
      prev
        .filter((l) => l.id !== id)
        .map((l) => (l.order > order ? { ...l, order: l.order - 1 } : l))
        .sort((a, b) => a.order - b.order)
    );
  }

  async function directDialogue() {
    if (!directionModelId) {
      toast.error("Pick a Dialogue Direction model first.");
      return;
    }
    setDirecting(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/dialogue-direction/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: directionModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Direction failed");
      }
      const data: { lines: DialogueLineItem[] } = await res.json();
      mergeLinesLocal(data.lines);
      toast.success("Dialogue directed — review each line's delivery below.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Direction failed.");
    } finally {
      setDirecting(false);
    }
  }

  async function draftScript() {
    if (!scriptModelId) {
      toast.error("Pick a Script Drafting model first.");
      return;
    }
    setDrafting(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: scriptModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Drafting failed");
      }
      const draft: { narration: string | null; dialogueLines: DialogueLineItem[]; dialogueSkipped: boolean } =
        await res.json();
      setNarration(draft.narration ?? "");
      setSavedNarration(draft.narration ?? "");
      setDialogueLines(draft.dialogueLines);
      toast.success(
        draft.dialogueSkipped
          ? "Narration drafted — this scene already had dialogue lines, so those were left untouched."
          : "Narration and dialogue drafted — review below."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <Label className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
          Draft Script — proposes narration for this scene, plus dialogue lines for characters already attached to
          it (only if the scene has none yet)
        </Label>
        <ModelSelect jobType="SCRIPT_DRAFTING" value={scriptModelId} onChange={setScriptModelId} />
        <Button size="sm" variant="outline" onClick={draftScript} disabled={drafting}>
          <Wand2 className="size-3.5" />
          {drafting ? "Drafting…" : "Draft Narration & Dialogue"}
        </Button>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Narration script</Label>
        <Textarea
          rows={2}
          placeholder="What the narrator says over this scene…"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          className="mt-1.5"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Narrator voice: {narratorVoiceName ? <span className="font-medium">{narratorVoiceName}</span> : "not set — see Voice Settings above"}
        </p>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Label className="text-xs text-muted-foreground flex-1 min-w-[10rem]">Direct Narration</Label>
          <ModelSelect jobType="NARRATION_DIRECTION" value={narrationDirectionModelId} onChange={setNarrationDirectionModelId} />
          <Button size="sm" variant="outline" disabled={directingNarration || !savedNarration.trim()} onClick={directNarration}>
            <Wand2 className="size-3.5" />
            {directingNarration ? "Directing…" : "Direct Narration"}
          </Button>
        </div>
        <div className="mt-1.5 grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Style / delivery (emotion, tone, emphasis — from Direct Narration above, or written by hand)</Label>
          <Textarea
            rows={1}
            placeholder="e.g. measured, ominous, a long pause before the last sentence"
            value={narrationDeliveryNotes}
            onChange={(e) => setNarrationDeliveryNotes(e.target.value)}
          />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Label className="whitespace-nowrap text-xs text-muted-foreground">Rhythm / pace (0.25–4, blank = default)</Label>
          <input
            type="number"
            min={0.25}
            max={4}
            step={0.05}
            className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
            value={narrationSpeed}
            onChange={(e) => setNarrationSpeed(e.target.value)}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={saveNarration}
            disabled={savingNarration || !narrationDirty}
          >
            <Save className="size-3.5" />
            {savingNarration ? "Saving…" : "Save Script"}
          </Button>
          <ModelSelect jobType="VOICE" value={narrationModelId} onChange={setNarrationModelId} />
          <Button
            size="sm"
            onClick={generateNarration}
            disabled={generatingNarration || !savedNarration.trim() || !narratorVoiceName}
          >
            <Mic className="size-3.5" />
            {generatingNarration ? "Generating…" : "Generate Audio"}
          </Button>
        </div>
        {narrationAudio.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {narrationAudio.map((take) => (
              <AudioTakeRow
                key={take.id}
                take={take}
                onSelect={() => selectNarrationTake(take.id)}
                onDelete={() => deleteNarrationTake(take.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Dialogue</Label>
          <div className="flex items-center gap-2">
            <ModelSelect jobType="DIALOGUE_DIRECTION" value={directionModelId} onChange={setDirectionModelId} />
            <Button size="sm" variant="outline" disabled={directing || dialogueLines.length === 0} onClick={directDialogue}>
              <Wand2 className="size-3.5" />
              {directing ? "Directing…" : "Direct Dialogue"}
            </Button>
            <AddDialogueLineDialog characters={characters} onAdd={addDialogueLine} />
          </div>
        </div>
        {dialogueLines.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">No dialogue lines yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {dialogueLines.map((line, index) => (
              <DialogueLineRow
                key={line.id}
                line={line}
                characters={characters}
                isFirst={index === 0}
                isLast={index === dialogueLines.length - 1}
                onUpdate={updateLineLocal}
                onMove={mergeLinesLocal}
                onDelete={removeLineLocal}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AudioTakeRow({ take, onSelect, onDelete }: { take: AudioTake; onSelect: () => void; onDelete: () => void }) {
  return (
    <div className={`flex items-center gap-2 rounded-md border p-1.5 ${take.isSelected ? "border-foreground" : ""}`}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls src={take.url} className="h-8 flex-1" />
      <Button size="sm" variant={take.isSelected ? "default" : "outline"} onClick={onSelect} disabled={take.isSelected}>
        {take.isSelected ? "Selected" : "Use this take"}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onDelete} className="text-destructive">
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function AddDialogueLineDialog({
  characters,
  onAdd,
}: {
  characters: VoiceCharacterOption[];
  onAdd: (characterId: string, text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (characters.length === 0) {
    return <p className="text-xs text-muted-foreground">Add characters first to write dialogue.</p>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-3.5" />
        Add Line
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Dialogue Line</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Character</Label>
            <Select
              value={characterId}
              onValueChange={(v) => v && setCharacterId(v)}
              items={Object.fromEntries(characters.map((c) => [c.id, c.name]))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Line</Label>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={submitting || !text.trim() || !characterId}
            onClick={async () => {
              setSubmitting(true);
              await onAdd(characterId, text);
              setSubmitting(false);
              setOpen(false);
              setText("");
            }}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogueLineRow({
  line,
  characters,
  isFirst,
  isLast,
  onUpdate,
  onMove,
  onDelete,
}: {
  line: DialogueLineItem;
  characters: VoiceCharacterOption[];
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (line: DialogueLineItem) => void;
  onMove: (lines: DialogueLineItem[]) => void;
  onDelete: (id: string, order: number) => void;
}) {
  const [text, setText] = useState(line.text);
  const [characterId, setCharacterId] = useState(line.character.id);
  const [deliveryNotes, setDeliveryNotes] = useState(line.deliveryNotes ?? "");
  const [speed, setSpeed] = useState(line.speed?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audio, setAudio] = useState(line.audio);

  const dirty =
    text !== line.text ||
    characterId !== line.character.id ||
    deliveryNotes !== (line.deliveryNotes ?? "") ||
    speed !== (line.speed?.toString() ?? "");
  const selectedCharacter = characters.find((c) => c.id === characterId);
  const voiceName = characterId === line.character.id ? line.character.voiceName : selectedCharacter?.voiceName ?? null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/dialogue-lines/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          characterId,
          deliveryNotes: deliveryNotes || null,
          speed: speed ? Number(speed) : null,
        }),
      });
      if (!res.ok) throw new Error();
      const updated: DialogueLineItem = await res.json();
      setAudio(updated.audio);
      onUpdate(updated);
      toast.success("Dialogue line saved.");
    } catch {
      toast.error("Couldn't save dialogue line.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this dialogue line? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/dialogue-lines/${line.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(line.id, line.order);
      toast.success("Dialogue line deleted.");
    } catch {
      toast.error("Couldn't delete dialogue line.");
      setDeleting(false);
    }
  }

  async function move(direction: "up" | "down") {
    setMoving(true);
    try {
      const res = await fetch(`/api/dialogue-lines/${line.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onMove(data.lines);
    } catch {
      toast.error("Couldn't reorder line.");
    } finally {
      setMoving(false);
    }
  }

  async function generate() {
    if (!modelId) {
      toast.error("Pick a voice model first.");
      return;
    }
    if (dirty) {
      toast.error("Save the line before generating audio.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/dialogue-lines/${line.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const take: AudioTake = await res.json();
      setAudio((prev) => [take, ...prev.map((t) => ({ ...t, isSelected: false }))]);
      toast.success("Dialogue audio generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function selectTake(assetId: string) {
    const res = await fetch(`/api/dialogue-lines/${line.id}/audio/${assetId}`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select take.");
      return;
    }
    setAudio((prev) => prev.map((t) => ({ ...t, isSelected: t.id === assetId })));
  }

  async function deleteTake(assetId: string) {
    const res = await fetch(`/api/dialogue-lines/${line.id}/audio/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    setAudio((prev) => prev.filter((t) => t.id !== assetId));
  }

  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-2">
        <Select
          value={characterId}
          onValueChange={(v) => v && setCharacterId(v)}
          items={Object.fromEntries(characters.map((c) => [c.id, c.name]))}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {characters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" disabled={isFirst || moving} onClick={() => move("up")}>
            <ChevronUp className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={isLast || moving} onClick={() => move("down")}>
            <ChevronDown className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={deleting} onClick={remove} className="text-destructive">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <Textarea rows={2} className="mt-1.5" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mt-1 text-xs text-muted-foreground">
        Voice: {voiceName ? <span className="font-medium">{voiceName}</span> : `not set — edit ${selectedCharacter?.name ?? line.character.name}'s Character profile`}
      </p>

      <div className="mt-1.5 grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Style / delivery (emotion, tone, emphasis — from Direct Dialogue above, or written by hand)</Label>
        <Textarea
          rows={1}
          placeholder="e.g. anxious, quiet, hesitant pauses between phrases"
          value={deliveryNotes}
          onChange={(e) => setDeliveryNotes(e.target.value)}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Label className="whitespace-nowrap text-xs text-muted-foreground">Rhythm / pace (0.25–4, blank = default)</Label>
        <input
          type="number"
          min={0.25}
          max={4}
          step={0.05}
          className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
          value={speed}
          onChange={(e) => setSpeed(e.target.value)}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <ModelSelect jobType="VOICE" value={modelId} onChange={setModelId} />
        <Button size="sm" onClick={generate} disabled={generating || !line.text.trim() || !voiceName || dirty}>
          {generating ? "Generating…" : "Generate Audio"}
        </Button>
      </div>
      {audio.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {audio.map((take) => (
            <AudioTakeRow
              key={take.id}
              take={take}
              onSelect={() => selectTake(take.id)}
              onDelete={() => deleteTake(take.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
