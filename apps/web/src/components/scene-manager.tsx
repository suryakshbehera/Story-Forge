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
import { Sparkles, Plus, Save, Trash2, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";

export type SceneVisualMode = "ILLUSTRATION" | "IMAGE_TO_VIDEO";

export interface TagOption {
  id: string;
  name: string;
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
}

const VISUAL_MODE_LABELS: Record<SceneVisualMode, string> = {
  ILLUSTRATION: "Illustration",
  IMAGE_TO_VIDEO: "Image → Video",
};

export function SceneManager({
  parentType,
  parentId,
  initialScenes,
  characters,
  locations,
}: {
  parentType: "story" | "episode";
  parentId: string;
  initialScenes: SceneItem[];
  characters: TagOption[];
  locations: TagOption[];
}) {
  const [scenes, setScenes] = useState(initialScenes);
  const [modelId, setModelId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [unmatchedNames, setUnmatchedNames] = useState<string[] | null>(null);

  const baseUrl = parentType === "story" ? `/api/stories/${parentId}/scenes` : `/api/episodes/${parentId}/scenes`;

  function updateScene(scene: SceneItem) {
    setScenes((prev) => prev.map((s) => (s.id === scene.id ? scene : s)).sort((a, b) => a.order - b.order));
  }

  function mergeScenes(updated: SceneItem[]) {
    setScenes((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const u of updated) byId.set(u.id, u);
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
      setScenes(data.scenes);
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
    const scene: SceneItem = await res.json();
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
}: {
  scene: SceneItem;
  isFirst: boolean;
  isLast: boolean;
  characters: TagOption[];
  locations: TagOption[];
  onUpdate: (scene: SceneItem) => void;
  onMove: (scenes: SceneItem[]) => void;
  onDelete: (id: string, order: number) => void;
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

        <Button onClick={save} disabled={!dirty || saving} className="self-start">
          <Save className="size-4" />
          {saving ? "Saving…" : "Save Scene"}
        </Button>
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
