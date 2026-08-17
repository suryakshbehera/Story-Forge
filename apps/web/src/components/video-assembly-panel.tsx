"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ModelSelect } from "@/components/model-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Clapperboard, Trash2 } from "lucide-react";

export interface FinalVideoItem {
  id: string;
  url: string;
  isSelected: boolean;
}

// parentType/parentId route to /api/stories/[id]/video/... or
// /api/episodes/[id]/video/... — same dual-parent pattern as SceneManager's
// parentType prop for scene creation.
export function VideoAssemblyPanel({
  parentType,
  parentId,
  initialFinalVideos,
}: {
  parentType: "story" | "episode";
  parentId: string;
  initialFinalVideos: FinalVideoItem[];
}) {
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [finalVideos, setFinalVideos] = useState(initialFinalVideos);
  // Off by default — matches the pre-existing behavior of always discarding
  // a video clip's own baked-in audio (e.g. Veo3 Lite's generated sound) in
  // favor of just narration/dialogue/music/sfx.
  const [includeClipAudio, setIncludeClipAudio] = useState(false);

  const base = parentType === "story" ? `/api/stories/${parentId}/video` : `/api/episodes/${parentId}/video`;

  async function generate() {
    if (!modelId) {
      toast.error("Pick a video model first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, includeClipAudio }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Assembly failed");
      }
      const video: FinalVideoItem = await res.json();
      setFinalVideos((prev) => [video, ...prev.map((v) => ({ ...v, isSelected: false }))]);
      toast.success("Final video assembled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assembly failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function selectVideo(assetId: string) {
    const res = await fetch(`${base}/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select this video.");
      return;
    }
    setFinalVideos((prev) => prev.map((v) => ({ ...v, isSelected: v.id === assetId })));
  }

  async function deleteVideo(assetId: string) {
    if (!confirm("Delete this final video? This can't be undone.")) return;
    const res = await fetch(`${base}/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete this video.");
      return;
    }
    setFinalVideos((prev) => prev.filter((v) => v.id !== assetId));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Stitches every scene&apos;s selected image/clip and narration/dialogue audio, in order, into one final video.
        Each scene needs a selected visual first — missing audio just means a silent scene.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <ModelSelect jobType="VIDEO" value={modelId} onChange={setModelId} />
        <Button size="sm" onClick={generate} disabled={generating}>
          <Clapperboard className="size-3.5" />
          {generating ? "Assembling…" : "Assemble Final Video"}
        </Button>
        <div className="flex items-center gap-1.5">
          <Switch id="include-clip-audio" checked={includeClipAudio} onCheckedChange={setIncludeClipAudio} />
          <Label htmlFor="include-clip-audio" className="text-xs text-muted-foreground">
            Include clip audio (e.g. Veo3)
          </Label>
        </div>
      </div>

      {finalVideos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {finalVideos.map((video) => (
            <div key={video.id} className={`flex items-center gap-2 rounded-md border p-1.5 ${video.isSelected ? "border-foreground" : ""}`}>
              <video controls src={video.url} className="h-24 w-40 rounded object-cover" />
              <Button size="sm" variant={video.isSelected ? "default" : "outline"} onClick={() => selectVideo(video.id)} disabled={video.isSelected}>
                {video.isSelected ? "Selected" : "Use this render"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => deleteVideo(video.id)} className="ml-auto text-destructive">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
