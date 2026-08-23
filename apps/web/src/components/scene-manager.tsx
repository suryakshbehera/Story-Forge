"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelSelect } from "@/components/model-select";
import { SceneVoicePanel, type AudioTake, type DialogueLineItem } from "@/components/scene-voice-panel";
import { SceneVideoPanel, type SceneVideoClipItem } from "@/components/scene-video-panel";
import { SceneAudioPanel } from "@/components/scene-audio-panel";
import { ShotManager, type ShotItem } from "@/components/shot-manager";
import {
  Sparkles,
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";

export type SceneVisualMode = "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";

export interface TagOption {
  id: string;
  name: string;
  // Only meaningful for characters (Phase 4) — absent/undefined for
  // locations, which have no voice concept.
  voiceName?: string | null;
}

export interface SceneItem {
  id: string;
  order: number;
  title: string | null;
  description: string;
  visualMode: SceneVisualMode;
  visualModeReason: string | null;
  characters: TagOption[];
  locations: TagOption[];
  // Phase 8 — Scene stopped being the image unit; shots carry the visuals.
  shots: ShotItem[];
  narration: string | null;
  narrationDeliveryNotes: string | null;
  narrationSpeed: number | null;
  narrationAudio: AudioTake[];
  dialogueLines: DialogueLineItem[];
  motionPrompt: string | null;
  videoPrompt: string | null;
  videoDurationSeconds: number | null;
  videoResolution: string | null;
  videoGenerateAudio: boolean;
  videoClips: SceneVideoClipItem[];
  musicPrompt: string | null;
  sfxPrompt: string | null;
  musicVolume: number;
  sfxVolume: number;
  music: AudioTake[];
  sfx: AudioTake[];
}

// Cycled per scene purely so adjacent scenes are visually distinguishable
// at a glance — low-opacity so it reads as a tint, not a solid fill, and
// stays legible in both light and dark mode.
const SCENE_COLORS = [
  "bg-rose-500/5 border-rose-500/20",
  "bg-amber-500/5 border-amber-500/20",
  "bg-emerald-500/5 border-emerald-500/20",
  "bg-sky-500/5 border-sky-500/20",
  "bg-violet-500/5 border-violet-500/20",
  "bg-pink-500/5 border-pink-500/20",
];

const VISUAL_MODE_LABELS: Record<SceneVisualMode, string> = {
  ILLUSTRATION: "Illustration",
  IMAGE_TO_VIDEO: "Image → Video",
  TEXT_TO_VIDEO: "Text → Video",
};

// For scenes that are genuinely new or just replaced everything (addScene,
// generate's regenerateAll) — SCENE_INCLUDE doesn't fetch Phase 4's
// narrationAudio/dialogueLines, so the response has them as `undefined`, and
// there's no prior client state to fall back to (it's a fresh scene, or the
// old one was just deleted server-side). Empty arrays are the correct value
// here. Contrast with updateScene()/mergeScenes() below, which preserve
// prior values instead — see their comment for why those are different.
function withVoiceDefaults(scene: SceneItem): SceneItem {
  return {
    ...scene,
    narration: scene.narration ?? null,
    narrationDeliveryNotes: scene.narrationDeliveryNotes ?? null,
    narrationSpeed: scene.narrationSpeed ?? null,
    narrationAudio: scene.narrationAudio ?? [],
    dialogueLines: scene.dialogueLines ?? [],
    videoClips: scene.videoClips ?? [],
    music: scene.music ?? [],
    sfx: scene.sfx ?? [],
  };
}

export function SceneManager({
  parentType,
  parentId,
  projectId,
  initialScenes,
  characters,
  locations,
  initialNarratorVoiceName,
}: {
  parentType: "story" | "episode";
  parentId: string;
  projectId: string;
  initialScenes: SceneItem[];
  characters: TagOption[];
  locations: TagOption[];
  initialNarratorVoiceName: string | null;
}) {
  const [scenes, setScenes] = useState(initialScenes);
  const [modelId, setModelId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [unmatchedNames, setUnmatchedNames] = useState<string[] | null>(null);

  const [promptModelId, setPromptModelId] = useState("");
  const [imageModelId, setImageModelId] = useState("");
  const [validationModelId, setValidationModelId] = useState("");
  const [imageInstructions, setImageInstructions] = useState("");
  // Phase 8 — shared across every shot's "Generate Shots" button, same
  // "one settings card, click applies to whichever row you're on" pattern
  // the Image Generation settings above already use.
  const [shotPlanningModelId, setShotPlanningModelId] = useState("");

  // Project-wide, not per-scene — Character/narrator voices are asked to
  // stay consistent across an entire story, not vary scene to scene. See
  // Project.narratorVoiceName in schema.prisma and scene-voice-panel.tsx.
  const [narratorVoiceName, setNarratorVoiceName] = useState(initialNarratorVoiceName ?? "");
  const [savedNarratorVoiceName, setSavedNarratorVoiceName] = useState(initialNarratorVoiceName ?? "");
  const [savingNarratorVoice, setSavingNarratorVoice] = useState(false);

  async function saveNarratorVoice() {
    setSavingNarratorVoice(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narratorVoiceName: narratorVoiceName || null }),
      });
      if (!res.ok) throw new Error();
      setSavedNarratorVoiceName(narratorVoiceName);
      toast.success("Narrator voice saved.");
    } catch {
      toast.error("Couldn't save narrator voice.");
    } finally {
      setSavingNarratorVoice(false);
    }
  }

  const baseUrl = parentType === "story" ? `/api/stories/${parentId}/scenes` : `/api/episodes/${parentId}/scenes`;

  // /api/scenes/[id] (PATCH) and .../move both return scenes via
  // SCENE_INCLUDE, which doesn't fetch Phase 4's narrationAudio/dialogueLines
  // — those aren't actually gone server-side, the endpoint just doesn't
  // report them, so merges here must carry the previous values forward
  // rather than defaulting to empty (that's only correct for a genuinely new
  // or AI-regenerated scene — see generate()/addScene() below).
  function updateScene(scene: SceneItem) {
    setScenes((prev) =>
      prev
        .map((s) =>
          s.id === scene.id
            ? {
                ...scene,
                narrationAudio: scene.narrationAudio ?? s.narrationAudio,
                dialogueLines: scene.dialogueLines ?? s.dialogueLines,
                videoClips: scene.videoClips ?? s.videoClips,
                music: scene.music ?? s.music,
                sfx: scene.sfx ?? s.sfx,
              }
            : s
        )
        .sort((a, b) => a.order - b.order)
    );
  }

  function mergeScenes(updated: SceneItem[]) {
    setScenes((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const u of updated) {
        const existing = byId.get(u.id);
        byId.set(u.id, {
          ...u,
          narrationAudio: u.narrationAudio ?? existing?.narrationAudio ?? [],
          dialogueLines: u.dialogueLines ?? existing?.dialogueLines ?? [],
          videoClips: u.videoClips ?? existing?.videoClips ?? [],
          music: u.music ?? existing?.music ?? [],
          sfx: u.sfx ?? existing?.sfx ?? [],
        });
      }
      return Array.from(byId.values()).sort((a, b) => a.order - b.order);
    });
  }

  function removeScene(id: string, order: number) {
    setScenes((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s) => (s.order > order ? { ...s, order: s.order - 1 } : s))
        .sort((a, b) => a.order - b.order)
    );
  }

  async function generate() {
    if (!modelId) {
      toast.error("Pick a model first.");
      return;
    }
    const regenerateAll = scenes.length > 0;
    if (regenerateAll) {
      const ok = confirm(
        `This deletes all ${scenes.length} existing scenes and replaces them with a new AI-generated set. Continue?`
      );
      if (!ok) return;
    }
    setGenerating(true);
    setUnmatchedNames(null);
    try {
      const res = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, instructions, regenerateAll }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const data = await res.json();
      setScenes(data.scenes.map(withVoiceDefaults));
      if (data.unmatchedNames?.length > 0) {
        setUnmatchedNames(data.unmatchedNames);
        toast.warning(`AI mentioned ${data.unmatchedNames.length} name(s) that don't exist yet.`);
      }
      toast.success(`Generated ${data.scenes.length} scene(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function addScene(fields: { title: string; description: string; visualMode: SceneVisualMode }) {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: scenes.length + 1,
        title: fields.title || null,
        description: fields.description,
        visualMode: fields.visualMode,
      }),
    });
    if (!res.ok) {
      toast.error("Couldn't add scene.");
      return;
    }
    const scene: SceneItem = withVoiceDefaults(await res.json());
    setScenes((prev) => [...prev, scene].sort((a, b) => a.order - b.order));
    toast.success("Scene added.");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label="Model">
            <ModelSelect jobType="SCENE_PLANNING" value={modelId} onChange={setModelId} />
          </Field>
          <Field label="Instructions">
            <Textarea
              rows={2}
              placeholder='e.g. "Keep scenes short" or "Break this into scenes now."'
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>
          <Button onClick={generate} disabled={generating} className="self-start">
            <Sparkles className="size-4" />
            {generating ? "Generating…" : scenes.length === 0 ? "Generate Scenes" : "Regenerate All Scenes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shots &amp; Image Generation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Shot Planning Model">
              <ModelSelect jobType="SHOT_PLANNING" value={shotPlanningModelId} onChange={setShotPlanningModelId} />
            </Field>
            <Field label="Image Prompt Model">
              <ModelSelect jobType="IMAGE_PROMPTS" value={promptModelId} onChange={setPromptModelId} />
            </Field>
            <Field label="Image Generation Model">
              <ModelSelect jobType="IMAGE_GENERATION" value={imageModelId} onChange={setImageModelId} />
            </Field>
            <Field label="Validation Model">
              <ModelSelect jobType="IMAGE_VALIDATION" value={validationModelId} onChange={setValidationModelId} />
            </Field>
          </div>
          <Field label="Instructions (applies whenever you generate a shot image)">
            <Textarea
              rows={2}
              placeholder='e.g. "cinematic lighting, wide shot"'
              value={imageInstructions}
              onChange={(e) => setImageInstructions(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Click &quot;Generate Shots&quot; or &quot;Generate Image&quot; on any scene/shot below — these settings apply each time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label="Narrator voice (ElevenLabs voice ID or Sarvam speaker name, matching whichever provider you pick when generating — used for every scene's narration in this project)">
            <div className="flex gap-2">
              <Input
                className="max-w-xs"
                placeholder='e.g. "21m00Tcm4TlvDq8ikWAM" (ElevenLabs) or "shubh" (Sarvam)'
                value={narratorVoiceName}
                onChange={(e) => setNarratorVoiceName(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={saveNarratorVoice}
                disabled={savingNarratorVoice || narratorVoiceName === savedNarratorVoiceName}
              >
                <Save className="size-3.5" />
                {savingNarratorVoice ? "Saving…" : "Save"}
              </Button>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Character voices are set per-character in their Character profile, so each character
            stays consistent across every scene too.
          </p>
        </CardContent>
      </Card>

      {unmatchedNames && unmatchedNames.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-2 py-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p>
                AI mentioned characters/locations that don&apos;t exist yet:{" "}
                <span className="font-medium">{unmatchedNames.join(", ")}</span>. Add them in Characters/Locations,
                then edit the affected scenes to tag them.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setUnmatchedNames(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {scenes.length} scene{scenes.length === 1 ? "" : "s"}
        </h3>
        <AddSceneDialog onAdd={addScene} />
      </div>

      {scenes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No scenes yet — generate from the written content above, or add one manually.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {scenes.map((scene, index) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              isFirst={index === 0}
              isLast={index === scenes.length - 1}
              colorClass={SCENE_COLORS[index % SCENE_COLORS.length]}
              characters={characters}
              locations={locations}
              onUpdate={updateScene}
              onMove={mergeScenes}
              onDelete={removeScene}
              promptModelId={promptModelId}
              imageModelId={imageModelId}
              validationModelId={validationModelId}
              imageInstructions={imageInstructions}
              shotPlanningModelId={shotPlanningModelId}
              narratorVoiceName={savedNarratorVoiceName || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddSceneDialog({
  onAdd,
}: {
  onAdd: (fields: { title: string; description: string; visualMode: SceneVisualMode }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visualMode, setVisualMode] = useState<SceneVisualMode>("ILLUSTRATION");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        Add Scene
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Scene</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Title (optional)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Visual Mode</Label>
            <VisualModeSelect value={visualMode} onChange={setVisualMode} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={submitting || !description.trim()}
            onClick={async () => {
              setSubmitting(true);
              await onAdd({ title, description, visualMode });
              setSubmitting(false);
              setOpen(false);
              setTitle("");
              setDescription("");
              setVisualMode("ILLUSTRATION");
            }}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SceneRow({
  scene,
  isFirst,
  isLast,
  colorClass,
  characters,
  locations,
  onUpdate,
  onMove,
  onDelete,
  promptModelId,
  imageModelId,
  validationModelId,
  imageInstructions,
  shotPlanningModelId,
  narratorVoiceName,
}: {
  scene: SceneItem;
  isFirst: boolean;
  isLast: boolean;
  colorClass: string;
  characters: TagOption[];
  locations: TagOption[];
  onUpdate: (scene: SceneItem) => void;
  onMove: (scenes: SceneItem[]) => void;
  onDelete: (id: string, order: number) => void;
  promptModelId: string;
  imageModelId: string;
  validationModelId: string;
  imageInstructions: string;
  shotPlanningModelId: string;
  narratorVoiceName: string | null;
}) {
  const [title, setTitle] = useState(scene.title ?? "");
  const [description, setDescription] = useState(scene.description);
  const [visualMode, setVisualMode] = useState<SceneVisualMode>(scene.visualMode);
  const [visualModeReason, setVisualModeReason] = useState(scene.visualModeReason ?? "");
  const [characterIds, setCharacterIds] = useState(new Set(scene.characters.map((c) => c.id)));
  const [locationIds, setLocationIds] = useState(new Set(scene.locations.map((l) => l.id)));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);

  const dirty =
    title !== (scene.title ?? "") ||
    description !== scene.description ||
    visualMode !== scene.visualMode ||
    visualModeReason !== (scene.visualModeReason ?? "") ||
    !sameSet(characterIds, new Set(scene.characters.map((c) => c.id))) ||
    !sameSet(locationIds, new Set(scene.locations.map((l) => l.id)));

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || null,
          description,
          visualMode,
          visualModeReason: visualModeReason || null,
          characterIds: Array.from(characterIds),
          locationIds: Array.from(locationIds),
        }),
      });
      if (!res.ok) throw new Error();
      // Deliberately not defaulted here — updateScene() (the onUpdate
      // handler) needs to see a real `undefined` on narrationAudio/
      // dialogueLines to know it should carry the previous values forward
      // instead of treating them as wiped. See its comment.
      const updated: SceneItem = await res.json();
      onUpdate(updated);
      toast.success("Scene saved.");
    } catch {
      toast.error("Couldn't save scene.");
    } finally {
      setSaving(false);
    }
  }

  async function move(direction: "up" | "down") {
    setMoving(true);
    try {
      const res = await fetch(`/api/scenes/${scene.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onMove(data.scenes);
    } catch {
      toast.error("Couldn't reorder scene.");
    } finally {
      setMoving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete scene ${scene.order}${scene.title ? ` (${scene.title})` : ""}? This can't be undone.`))
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/scenes/${scene.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(scene.id, scene.order);
      toast.success("Scene deleted.");
    } catch {
      toast.error("Couldn't delete scene.");
      setDeleting(false);
    }
  }

  return (
    <Card className={colorClass}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          #{scene.order} {title || <span className="text-muted-foreground">Untitled Scene</span>}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" disabled={isFirst || moving} onClick={() => move("up")}>
            <ChevronUp className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={isLast || moving} onClick={() => move("down")}>
            <ChevronDown className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={deleting} onClick={remove} className="text-destructive">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Visual Mode">
            <VisualModeSelect value={visualMode} onChange={setVisualMode} />
          </Field>
          <Field label="AI reasoning (editable)">
            <Textarea rows={1} value={visualModeReason} onChange={(e) => setVisualModeReason(e.target.value)} />
          </Field>
        </div>

        <Field label="Characters">
          {characters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No characters yet — add some in the Characters tab.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => (
                <Badge
                  key={c.id}
                  variant={characterIds.has(c.id) ? "default" : "outline"}
                  render={<button type="button" onClick={() => toggle(characterIds, setCharacterIds, c.id)} />}
                >
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
        </Field>

        <Field label="Locations">
          {locations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No locations yet — add some in the Locations tab.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l) => (
                <Badge
                  key={l.id}
                  variant={locationIds.has(l.id) ? "default" : "outline"}
                  render={<button type="button" onClick={() => toggle(locationIds, setLocationIds, l.id)} />}
                >
                  {l.name}
                </Badge>
              ))}
            </div>
          )}
        </Field>

        <Button onClick={save} disabled={!dirty || saving} className="self-start">
          <Save className="size-4" />
          {saving ? "Saving…" : "Save Scene"}
        </Button>

        {scene.visualMode !== "TEXT_TO_VIDEO" && (
          <ShotManager
            sceneId={scene.id}
            sceneVisualMode={scene.visualMode}
            initialShots={scene.shots}
            promptModelId={promptModelId}
            imageModelId={imageModelId}
            validationModelId={validationModelId}
            imageInstructions={imageInstructions}
            shotPlanningModelId={shotPlanningModelId}
            onShotsChange={(shots) => onUpdate({ ...scene, shots })}
          />
        )}

        {(scene.visualMode === "IMAGE_TO_VIDEO" || scene.visualMode === "TEXT_TO_VIDEO") && (
          <SceneVideoPanel
            sceneId={scene.id}
            mode={scene.visualMode}
            hasSelectedImage={scene.shots[0]?.images.some((img) => img.isSelected) ?? false}
            shotCount={scene.shots.length}
            allShotsHaveImages={scene.shots.length > 0 && scene.shots.every((s) => s.images.some((img) => img.isSelected))}
            initialMotionPrompt={scene.motionPrompt ?? ""}
            initialVideoPrompt={scene.videoPrompt ?? ""}
            initialVideoDurationSeconds={scene.videoDurationSeconds}
            initialVideoResolution={scene.videoResolution}
            initialVideoGenerateAudio={scene.videoGenerateAudio}
            initialVideoClips={scene.videoClips}
          />
        )}

        <SceneVoicePanel
          sceneId={scene.id}
          characters={characters.map((c) => ({ id: c.id, name: c.name, voiceName: c.voiceName ?? null }))}
          narratorVoiceName={narratorVoiceName}
          initialNarration={scene.narration ?? ""}
          initialNarrationDeliveryNotes={scene.narrationDeliveryNotes}
          initialNarrationSpeed={scene.narrationSpeed}
          initialNarrationAudio={scene.narrationAudio}
          initialDialogueLines={scene.dialogueLines}
        />

        <SceneAudioPanel
          sceneId={scene.id}
          initialMusicPrompt={scene.musicPrompt ?? ""}
          initialSfxPrompt={scene.sfxPrompt ?? ""}
          initialMusicVolume={scene.musicVolume}
          initialSfxVolume={scene.sfxVolume}
          initialMusic={scene.music}
          initialSfx={scene.sfx}
        />
      </CardContent>
    </Card>
  );
}

function VisualModeSelect({ value, onChange }: { value: SceneVisualMode; onChange: (v: SceneVisualMode) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as SceneVisualMode)} items={VISUAL_MODE_LABELS}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(VISUAL_MODE_LABELS) as SceneVisualMode[]).map((mode) => (
          <SelectItem key={mode} value={mode}>
            {VISUAL_MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
