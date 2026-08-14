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
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  ImagePlus,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";

export type SceneVisualMode = "ILLUSTRATION" | "IMAGE_TO_VIDEO";

export interface TagOption {
  id: string;
  name: string;
  // Only meaningful for characters (Phase 4) — absent/undefined for
  // locations, which have no voice concept.
  voiceName?: string | null;
}

export interface SceneImageItem {
  id: string;
  url: string;
  isSelected: boolean;
  validationPassed: boolean | null;
  validationNotes: string | null;
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
  images: SceneImageItem[];
  narration: string | null;
  narrationAudio: AudioTake[];
  dialogueLines: DialogueLineItem[];
}

const VISUAL_MODE_LABELS: Record<SceneVisualMode, string> = {
  ILLUSTRATION: "Illustration",
  IMAGE_TO_VIDEO: "Image → Video",
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
    narrationAudio: scene.narrationAudio ?? [],
    dialogueLines: scene.dialogueLines ?? [],
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
            ? { ...scene, narrationAudio: scene.narrationAudio ?? s.narrationAudio, dialogueLines: scene.dialogueLines ?? s.dialogueLines }
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

  async function generateImageForScene(sceneId: string) {
    if (!promptModelId || !imageModelId) {
      toast.error("Pick an Image Prompt and Image Generation model first.");
      return;
    }
    const res = await fetch(`/api/scenes/${sceneId}/images/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptModelId,
        imageModelId,
        validationModelId: validationModelId || undefined,
        instructions: imageInstructions,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Image generation failed.");
      return;
    }
    const data: { image: SceneImageItem; missingReferenceFor: string[] } = await res.json();
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? { ...s, images: [data.image, ...s.images.map((img) => ({ ...img, isSelected: false }))] }
          : s
      )
    );
    if (data.missingReferenceFor.length > 0) {
      toast.warning(
        `No reference image for: ${data.missingReferenceFor.join(", ")} — consistency wasn't checked.`
      );
    } else {
      toast.success("Image generated.");
    }
  }

  async function selectSceneImage(sceneId: string, assetId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/images/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select image.");
      return;
    }
    const updated: SceneImageItem = await res.json();
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? { ...s, images: s.images.map((img) => (img.id === assetId ? updated : { ...img, isSelected: false })) }
          : s
      )
    );
  }

  async function deleteSceneImage(sceneId: string, assetId: string) {
    if (!confirm("Delete this generated image? This can't be undone.")) return;
    const res = await fetch(`/api/scenes/${sceneId}/images/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete image.");
      return;
    }
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, images: s.images.filter((img) => img.id !== assetId) } : s))
    );
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
          <CardTitle className="text-base">Image Generation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <Field label="Instructions (applies whenever you generate a scene image)">
            <Textarea
              rows={2}
              placeholder='e.g. "cinematic lighting, wide shot"'
              value={imageInstructions}
              onChange={(e) => setImageInstructions(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Click &quot;Generate Image&quot; on any scene below — these settings apply each time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label="Narrator voice (used for every scene's narration in this project)">
            <div className="flex gap-2">
              <Input
                className="max-w-xs"
                placeholder='e.g. "alloy"'
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
              characters={characters}
              locations={locations}
              onUpdate={updateScene}
              onMove={mergeScenes}
              onDelete={removeScene}
              onGenerateImage={() => generateImageForScene(scene.id)}
              onSelectImage={(assetId) => selectSceneImage(scene.id, assetId)}
              onDeleteImage={(assetId) => deleteSceneImage(scene.id, assetId)}
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
  characters,
  locations,
  onUpdate,
  onMove,
  onDelete,
  onGenerateImage,
  onSelectImage,
  onDeleteImage,
  narratorVoiceName,
}: {
  scene: SceneItem;
  isFirst: boolean;
  isLast: boolean;
  characters: TagOption[];
  locations: TagOption[];
  onUpdate: (scene: SceneItem) => void;
  onMove: (scenes: SceneItem[]) => void;
  onDelete: (id: string, order: number) => void;
  onGenerateImage: () => Promise<void>;
  onSelectImage: (assetId: string) => void;
  onDeleteImage: (assetId: string) => void;
  narratorVoiceName: string | null;
}) {
  const [title, setTitle] = useState(scene.title ?? "");
  const [description, setDescription] = useState(scene.description);
  const [visualMode, setVisualMode] = useState<SceneVisualMode>(scene.visualMode);
  const [visualModeReason, setVisualModeReason] = useState(scene.visualModeReason ?? "");
  const [imageGenerating, setImageGenerating] = useState(false);
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
    <Card>
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

        <Field label="Image">
          {scene.images.length === 0 ? (
            <p className="text-xs text-muted-foreground">No image generated yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {scene.images.map((img) => (
                <div key={img.id} className="group relative">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectImage(img.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelectImage(img.id)}
                    title={img.validationNotes ?? undefined}
                    className={cn(
                      "cursor-pointer overflow-hidden rounded-md border-2",
                      img.isSelected ? "border-foreground" : "border-transparent"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-24 w-40 object-cover" />
                  </div>
                  <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-background/80 p-0.5">
                    {img.validationPassed === true && <CheckCircle2 className="size-3.5 text-green-600" />}
                    {img.validationPassed === false && <XCircle className="size-3.5 text-amber-600" />}
                    {img.validationPassed === null && <HelpCircle className="size-3.5 text-muted-foreground" />}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteImage(img.id)}
                    className="absolute left-1 top-1 hidden rounded-full bg-background/80 p-0.5 group-hover:block"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={imageGenerating}
            className="mt-2 self-start"
            onClick={async () => {
              setImageGenerating(true);
              await onGenerateImage();
              setImageGenerating(false);
            }}
          >
            <ImagePlus className="size-4" />
            {imageGenerating ? "Generating…" : scene.images.length === 0 ? "Generate Image" : "Generate Another"}
          </Button>
        </Field>

        <Button onClick={save} disabled={!dirty || saving} className="self-start">
          <Save className="size-4" />
          {saving ? "Saving…" : "Save Scene"}
        </Button>

        <SceneVoicePanel
          sceneId={scene.id}
          characters={characters.map((c) => ({ id: c.id, name: c.name, voiceName: c.voiceName ?? null }))}
          narratorVoiceName={narratorVoiceName}
          initialNarration={scene.narration ?? ""}
          initialNarrationAudio={scene.narrationAudio}
          initialDialogueLines={scene.dialogueLines}
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
