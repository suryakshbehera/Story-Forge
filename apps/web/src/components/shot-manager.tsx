"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isImageGenerationActive } from "@/lib/shot-image-generation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  ImagePlus,
  Upload,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";

export type CameraMovement = "STATIC" | "ZOOM_IN" | "ZOOM_OUT" | "PAN_LEFT" | "PAN_RIGHT" | "PAN_UP" | "PAN_DOWN";

const CAMERA_MOVEMENT_LABELS: Record<CameraMovement, string> = {
  STATIC: "None (static)",
  ZOOM_IN: "Zoom in",
  ZOOM_OUT: "Zoom out",
  PAN_LEFT: "Pan left",
  PAN_RIGHT: "Pan right",
  PAN_UP: "Pan up",
  PAN_DOWN: "Pan down",
};

export interface ShotImageItem {
  id: string;
  url: string;
  isSelected: boolean;
  validationPassed: boolean | null;
  validationNotes: string | null;
}

export interface ShotItem {
  id: string;
  order: number;
  description: string;
  cameraMovement: CameraMovement;
  durationSeconds: number | null;
  images: ShotImageItem[];
  // Non-null and recent means a generation is genuinely in flight (this tab,
  // another tab, or before a reload) — see lib/shot-image-generation.ts for
  // the staleness rule that keeps this from being read as "generating"
  // forever if the server died mid-request.
  imageGenerationStartedAt: string | null;
}

// Shots are continuity, not alternates — shot 2 continues the scene from
// shot 1, it never re-generates the same moment. Alternates only exist
// *within* one shot's own image gallery below (same isSelected take-history
// pattern Scene.images used to have). Image generation reuses the exact
// same shared Image Generation settings (prompt/image/validation model +
// instructions) the scene editor already had — clicking "Generate Image" on
// any shot applies them, same as it did for scenes before Phase 8.
export function ShotManager({
  sceneId,
  sceneVisualMode,
  initialShots,
  promptModelId,
  imageModelId,
  validationModelId,
  imageInstructions,
  shotPlanningModelId,
}: {
  sceneId: string;
  sceneVisualMode: "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  initialShots: ShotItem[];
  promptModelId: string;
  imageModelId: string;
  validationModelId: string;
  imageInstructions: string;
  shotPlanningModelId: string;
}) {
  const [shots, setShots] = useState(initialShots);
  const [planning, setPlanning] = useState(false);
  const [adding, setAdding] = useState(false);

  async function generateShots() {
    if (!shotPlanningModelId) {
      toast.error("Pick a Shot Planning model first.");
      return;
    }
    const regenerateAll = shots.length > 0;
    if (regenerateAll) {
      const ok = confirm(`This deletes all ${shots.length} existing shot(s) (and their images) and replaces them. Continue?`);
      if (!ok) return;
    }
    setPlanning(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/shots/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: shotPlanningModelId, regenerateAll }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Shot planning failed");
      }
      const data: { shots: ShotItem[]; reason: string | null } = await res.json();
      setShots(data.shots);
      toast.success(data.reason ? `Generated ${data.shots.length} shot(s) — ${data.reason}` : `Generated ${data.shots.length} shot(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Shot planning failed.");
    } finally {
      setPlanning(false);
    }
  }

  async function addShot() {
    setAdding(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/shots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: shots.length + 1, description: "New shot" }),
      });
      if (!res.ok) throw new Error();
      const shot: ShotItem = await res.json();
      setShots((prev) => [...prev, shot].sort((a, b) => a.order - b.order));
    } catch {
      toast.error("Couldn't add shot.");
    } finally {
      setAdding(false);
    }
  }

  function updateShotInList(shot: ShotItem) {
    setShots((prev) => prev.map((s) => (s.id === shot.id ? shot : s)).sort((a, b) => a.order - b.order));
  }

  function moveShotInList(updated: ShotItem[]) {
    setShots((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const u of updated) byId.set(u.id, u);
      return Array.from(byId.values()).sort((a, b) => a.order - b.order);
    });
  }

  function removeShotFromList(id: string, order: number) {
    setShots((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s) => (s.order > order ? { ...s, order: s.order - 1 } : s))
        .sort((a, b) => a.order - b.order)
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">
          {shots.length} shot{shots.length === 1 ? "" : "s"} — each is its own continuity frame, not an alternate of the others
        </Label>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={planning} onClick={generateShots}>
            <Sparkles className="size-3.5" />
            {planning ? "Planning…" : shots.length === 0 ? "Generate Shots" : "Regenerate Shots"}
          </Button>
          <Button size="sm" variant="outline" disabled={adding} onClick={addShot}>
            <Plus className="size-3.5" />
            Add Shot
          </Button>
        </div>
      </div>

      {shots.length === 0 ? (
        <p className="text-xs text-muted-foreground">No shots yet — generate with AI or add one manually.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shots.map((shot, index) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              sceneVisualMode={sceneVisualMode}
              isFirst={index === 0}
              isLast={index === shots.length - 1}
              promptModelId={promptModelId}
              imageModelId={imageModelId}
              validationModelId={validationModelId}
              imageInstructions={imageInstructions}
              onUpdate={updateShotInList}
              onMove={moveShotInList}
              onDelete={removeShotFromList}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShotCard({
  shot,
  sceneVisualMode,
  isFirst,
  isLast,
  promptModelId,
  imageModelId,
  validationModelId,
  imageInstructions,
  onUpdate,
  onMove,
  onDelete,
}: {
  shot: ShotItem;
  sceneVisualMode: "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  isFirst: boolean;
  isLast: boolean;
  promptModelId: string;
  imageModelId: string;
  validationModelId: string;
  imageInstructions: string;
  onUpdate: (shot: ShotItem) => void;
  onMove: (shots: ShotItem[]) => void;
  onDelete: (id: string, order: number) => void;
}) {
  const [description, setDescription] = useState(shot.description);
  const [cameraMovement, setCameraMovement] = useState<CameraMovement>(shot.cameraMovement);
  const [durationSeconds, setDurationSeconds] = useState(shot.durationSeconds?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(() => isImageGenerationActive(shot.imageGenerationStartedAt));
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unmountedRef = useRef(false);
  useEffect(() => () => {
    unmountedRef.current = true;
  }, []);

  // Watches a generation claimed by someone/somewhen else — this tab before
  // a reload, or another tab entirely — until it finishes, so the spinner
  // this reflects is always backed by a real in-flight request rather than
  // stale local state. Stops as soon as the server-side claim clears.
  async function pollUntilGenerationIdle() {
    while (!unmountedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (unmountedRef.current) return;
      const res = await fetch(`/api/shots/${shot.id}`).catch(() => null);
      if (!res?.ok) continue;
      const updated: ShotItem = await res.json();
      if (!isImageGenerationActive(updated.imageGenerationStartedAt)) {
        if (!unmountedRef.current) {
          onUpdate(updated);
          setImageGenerating(false);
        }
        return;
      }
    }
  }

  // Mount-only: picks up a generation already in flight when this card first
  // renders (page load/reload, or a shot newly scrolled into view) — must
  // NOT re-run on every `shot` prop update, or a normal click-triggered
  // generation would spuriously kick off a second poll loop alongside it.
  useEffect(() => {
    if (isImageGenerationActive(shot.imageGenerationStartedAt)) {
      pollUntilGenerationIdle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    description !== shot.description ||
    cameraMovement !== shot.cameraMovement ||
    durationSeconds !== (shot.durationSeconds?.toString() ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          cameraMovement,
          durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        }),
      });
      if (!res.ok) throw new Error();
      const updated: ShotItem = await res.json();
      onUpdate(updated);
      toast.success("Shot saved.");
    } catch {
      toast.error("Couldn't save shot.");
    } finally {
      setSaving(false);
    }
  }

  async function move(direction: "up" | "down") {
    setMoving(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onMove(data.shots);
    } catch {
      toast.error("Couldn't reorder shot.");
    } finally {
      setMoving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete shot ${shot.order}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(shot.id, shot.order);
      toast.success("Shot deleted.");
    } catch {
      toast.error("Couldn't delete shot.");
      setDeleting(false);
    }
  }

  async function generateImage() {
    if (!promptModelId || !imageModelId) {
      toast.error("Pick an Image Prompt and Image Generation model first.");
      return;
    }
    setImageGenerating(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptModelId,
          imageModelId,
          validationModelId: validationModelId || undefined,
          instructions: imageInstructions,
        }),
      });
      // Another generation is already claimed for this shot (this tab from
      // before a reload, or another tab) — stay in the "Generating…" state
      // and watch for it to finish instead of erroring out into a button
      // that would just 409 again on the next click.
      if (res.status === 409) {
        toast.warning("Already generating for this shot — watching for it to finish.");
        pollUntilGenerationIdle();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Image generation failed.");
      }
      const data: { image: ShotImageItem; missingReferenceFor: string[] } = await res.json();
      onUpdate({
        ...shot,
        imageGenerationStartedAt: null,
        images: [data.image, ...shot.images.map((img) => ({ ...img, isSelected: false }))],
      });
      if (data.missingReferenceFor.length > 0) {
        toast.warning(`No reference image for: ${data.missingReferenceFor.join(", ")} — consistency wasn't checked.`);
      } else {
        toast.success("Image generated.");
      }
      setImageGenerating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image generation failed.");
      setImageGenerating(false);
    }
  }

  async function uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    setImageUploading(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}/images/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed.");
      }
      const image: ShotImageItem = await res.json();
      onUpdate({ ...shot, images: [image, ...shot.images.map((img) => ({ ...img, isSelected: false }))] });
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setImageUploading(false);
    }
  }

  async function selectImage(assetId: string) {
    const res = await fetch(`/api/shots/${shot.id}/images/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select image.");
      return;
    }
    onUpdate({ ...shot, images: shot.images.map((img) => (img.id === assetId ? { ...img, isSelected: true } : { ...img, isSelected: false })) });
  }

  async function deleteImage(assetId: string) {
    if (!confirm("Delete this generated image? This can't be undone.")) return;
    const res = await fetch(`/api/shots/${shot.id}/images/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete image.");
      return;
    }
    onUpdate({ ...shot, images: shot.images.filter((img) => img.id !== assetId) });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
        <CardTitle className="text-sm">Shot {shot.order}</CardTitle>
        <div className="flex items-center gap-1">
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
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 py-0 pb-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Description (what&apos;s on screen)</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {sceneVisualMode === "ILLUSTRATION" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Camera Movement</Label>
              <CameraMovementSelect value={cameraMovement} onChange={setCameraMovement} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Duration (s, optional override)</Label>
            <Input
              type="number"
              min={1}
              className="w-28"
              placeholder="auto"
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {shot.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {shot.images.map((img) => (
              <div key={img.id} className="group relative">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => selectImage(img.id)}
                  onKeyDown={(e) => e.key === "Enter" && selectImage(img.id)}
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
                  onClick={() => deleteImage(img.id)}
                  className="absolute left-1 top-1 hidden rounded-full bg-background/80 p-0.5 group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={imageGenerating} onClick={generateImage}>
            <ImagePlus className="size-3.5" />
            {imageGenerating ? "Generating…" : shot.images.length === 0 ? "Generate Image" : "Generate Another"}
          </Button>
          <Button size="sm" variant="outline" disabled={imageUploading} onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-3.5" />
            {imageUploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await uploadImage(file);
              e.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CameraMovementSelect({ value, onChange }: { value: CameraMovement; onChange: (v: CameraMovement) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as CameraMovement)} items={CAMERA_MOVEMENT_LABELS}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(CAMERA_MOVEMENT_LABELS) as CameraMovement[]).map((movement) => (
          <SelectItem key={movement} value={movement}>
            {CAMERA_MOVEMENT_LABELS[movement]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
