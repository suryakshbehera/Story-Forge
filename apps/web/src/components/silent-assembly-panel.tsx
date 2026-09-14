"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ModelSelect } from "@/components/model-select";
import { Clapperboard, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isGenerationActive } from "@/lib/generation-claims";
import { GenerationErrorBanner, type GenerationErrorInfo } from "@/components/generation-error";
import { useGenerationEstimate } from "@/lib/use-generation-estimate";

export interface SilentVideoItem {
  id: string;
  url: string;
  isSelected: boolean;
}

// parentType/parentId route to /api/stories/[id]/silent-video/... or
// /api/episodes/[id]/silent-video/... — same dual-parent pattern as
// VideoAssemblyPanel's parentType prop.
export function SilentAssemblyPanel({
  parentType,
  parentId,
  projectId,
  initialSilentVideos,
  initialSilentVideoGenerationStartedAt,
  initialError,
}: {
  parentType: "story" | "episode";
  parentId: string;
  projectId: string;
  initialSilentVideos: SilentVideoItem[];
  initialSilentVideoGenerationStartedAt: string | null;
  // Durable failure from GenerationEvent (getActiveFailures), seeding
  // lastError below — see ShotItem's lastImageError for the idea.
  initialError?: GenerationErrorInfo | null;
}) {
  const router = useRouter();
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(() =>
    isGenerationActive(initialSilentVideoGenerationStartedAt, "silentAssembly")
  );
  const [silentVideos, setSilentVideos] = useState(initialSilentVideos);
  const [lastError, setLastError] = useState<GenerationErrorInfo | null>(initialError ?? null);
  const { confirm, ConfirmDialog } = useConfirm();
  const unmountedRef = useRef(false);
  // No cost — local ffmpeg, not a paid API call — so this is duration/ETA
  // only. jobType "VIDEO" events never carry a modelId (see
  // lib/video-assembly.ts), so the estimate is jobType-wide, not per-model.
  const estimate = useGenerationEstimate(projectId, "VIDEO", null);
  const estimateText =
    estimate && estimate.sampleSize > 0 && estimate.medianDurationMs != null
      ? `~${Math.round(estimate.medianDurationMs / 1000)}s, based on ${estimate.sampleSize} past run${estimate.sampleSize > 1 ? "s" : ""} — no added cost, this step renders locally.`
      : null;

  const base = parentType === "story" ? `/api/stories/${parentId}/silent-video` : `/api/episodes/${parentId}/silent-video`;
  const statusUrl = parentType === "story" ? `/api/stories/${parentId}/status` : `/api/episodes/${parentId}/status`;

  useEffect(() => () => {
    unmountedRef.current = true;
  }, []);

  async function pollUntilGenerationIdle() {
    while (!unmountedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (unmountedRef.current) return;
      const res = await fetch(statusUrl).catch(() => null);
      if (!res?.ok) continue;
      const updated: { silentVideoGenerationStartedAt: string | null; silentVideos: SilentVideoItem[] } = await res.json();
      if (!isGenerationActive(updated.silentVideoGenerationStartedAt, "silentAssembly")) {
        if (!unmountedRef.current) {
          setSilentVideos(updated.silentVideos);
          setGenerating(false);
          router.refresh();
        }
        return;
      }
    }
  }

  useEffect(() => {
    if (isGenerationActive(initialSilentVideoGenerationStartedAt, "silentAssembly")) pollUntilGenerationIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (!modelId) {
      toast.error("Pick a video model first.");
      return;
    }
    setGenerating(true);
    setLastError(null);
    try {
      const res = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (res.status === 409) {
        toast.warning("Already assembling — watching for it to finish.");
        pollUntilGenerationIdle();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error ?? "Assembly failed";
        setLastError({ message, modelId: body.modelId, provider: body.provider });
        throw new Error(message);
      }
      const video: SilentVideoItem = await res.json();
      setSilentVideos((prev) => [video, ...prev.map((v) => ({ ...v, isSelected: false }))]);
      toast.success("Silent picture assembled.");
      router.refresh();
      setGenerating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assembly failed.");
      setGenerating(false);
    }
  }

  async function selectVideo(assetId: string) {
    const res = await fetch(`${base}/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select this take.");
      return;
    }
    setSilentVideos((prev) => prev.map((v) => ({ ...v, isSelected: v.id === assetId })));
    router.refresh();
  }

  async function deleteVideo(assetId: string) {
    const ok = await confirm({
      title: "Delete this silent assembly?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`${base}/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete this take.");
      return;
    }
    setSilentVideos((prev) => prev.filter((v) => v.id !== assetId));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Stitches every scene&apos;s selected image/clip, in order, with no narration/dialogue/music/sfx — a picture-only
        preview to review before drafting an Audio Cue Plan below. Each scene needs a selected visual first.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <ModelSelect jobType="VIDEO" value={modelId} onChange={setModelId} />
        <Button size="sm" onClick={generate} disabled={generating}>
          <Clapperboard className="size-3.5" />
          {generating ? "Assembling…" : "Assemble Silent Picture"}
        </Button>
      </div>
      {estimateText && <p className="text-xs text-muted-foreground">{estimateText}</p>}

      {lastError && (
        <GenerationErrorBanner error={lastError} onRetry={generate} onDismiss={() => setLastError(null)} />
      )}

      {silentVideos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {silentVideos.map((video) => (
            <div key={video.id} className={`flex items-center gap-2 rounded-md border p-1.5 ${video.isSelected ? "border-foreground" : ""}`}>
              <video controls muted src={video.url} className="h-24 w-40 rounded object-cover" />
              <Button size="sm" variant={video.isSelected ? "default" : "outline"} onClick={() => selectVideo(video.id)} disabled={video.isSelected}>
                {video.isSelected ? "Selected" : "Use this take"}
              </Button>
              <Button
                size="icon-sm"
                variant="destructive"
                aria-label="Delete silent video"
                onClick={() => deleteVideo(video.id)}
                className="ml-auto"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
