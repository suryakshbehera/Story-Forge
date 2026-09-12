"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelSelect } from "@/components/model-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Clapperboard, Download, Link2, Trash2 } from "lucide-react";
import { formatFileSize } from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isGenerationActive } from "@/lib/generation-claims";
import { GenerationErrorBanner, type GenerationErrorInfo } from "@/components/generation-error";

export interface FinalVideoItem {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: string | Date;
  fileName: string | null;
  sizeBytes: number | null;
}

// parentType/parentId route to /api/stories/[id]/video/... or
// /api/episodes/[id]/video/... — same dual-parent pattern as SceneManager's
// parentType prop for scene creation.
//
// Renders its own two Cards (Final Assembly, then Download & Share) rather
// than being wrapped in one Card by the page, unlike every sibling panel on
// this page — both stages share one `finalVideos` state (selecting a take
// in stage 3 is what stage 4 downloads), and that state has nowhere to live
// if the page (a Server Component) owned the Card split instead.
export function VideoAssemblyPanel({
  parentType,
  parentId,
  initialFinalVideos,
  initialFinalVideoGenerationStartedAt,
  hasSelectedSilentVideo,
}: {
  parentType: "story" | "episode";
  parentId: string;
  initialFinalVideos: FinalVideoItem[];
  initialFinalVideoGenerationStartedAt: string | null;
  hasSelectedSilentVideo: boolean;
}) {
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(() =>
    isGenerationActive(initialFinalVideoGenerationStartedAt, "finalAssembly")
  );
  const [finalVideos, setFinalVideos] = useState(initialFinalVideos);
  // Off by default — matches the pre-existing behavior of always discarding
  // a video clip's own baked-in audio (e.g. Veo3 Lite's generated sound) in
  // favor of just narration/dialogue/music/sfx.
  const [includeClipAudio, setIncludeClipAudio] = useState(false);
  const [lastError, setLastError] = useState<GenerationErrorInfo | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const unmountedRef = useRef(false);

  const base = parentType === "story" ? `/api/stories/${parentId}/video` : `/api/episodes/${parentId}/video`;
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
      const updated: { finalVideoGenerationStartedAt: string | null; finalVideos: FinalVideoItem[] } = await res.json();
      if (!isGenerationActive(updated.finalVideoGenerationStartedAt, "finalAssembly")) {
        if (!unmountedRef.current) {
          setFinalVideos(updated.finalVideos);
          setGenerating(false);
        }
        return;
      }
    }
  }

  useEffect(() => {
    if (isGenerationActive(initialFinalVideoGenerationStartedAt, "finalAssembly")) pollUntilGenerationIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (!hasSelectedSilentVideo) {
      toast.error("Assemble and select a silent picture above first.");
      return;
    }
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
        body: JSON.stringify({ modelId, includeClipAudio }),
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
      const video: FinalVideoItem = await res.json();
      setFinalVideos((prev) => [video, ...prev.map((v) => ({ ...v, isSelected: false }))]);
      toast.success("Final video assembled.");
      setGenerating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assembly failed.");
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
    const ok = await confirm({
      title: "Delete this final video?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`${base}/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete this video.");
      return;
    }
    setFinalVideos((prev) => prev.filter((v) => v.id !== assetId));
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy link.");
    }
  }

  const selectedVideo = finalVideos.find((v) => v.isSelected) ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 3 of 4 — Final Assembly</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Stitches every scene&apos;s selected image/clip and narration/dialogue audio, in order, into one final video.
            Each scene needs a selected visual first — missing audio just means a silent scene.
          </p>
          {!hasSelectedSilentVideo && (
            <p className="text-xs text-muted-foreground">Assemble and select a silent picture above first.</p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <ModelSelect jobType="VIDEO" value={modelId} onChange={setModelId} />
            <Button size="sm" onClick={generate} disabled={generating || !hasSelectedSilentVideo}>
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

          {lastError && (
            <GenerationErrorBanner error={lastError} onRetry={generate} onDismiss={() => setLastError(null)} />
          )}

          {finalVideos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {finalVideos.map((video) => (
                <div
                  key={video.id}
                  className={`flex flex-wrap items-center gap-2 rounded-md border p-1.5 ${video.isSelected ? "border-foreground" : ""}`}
                >
                  <video controls src={video.url} className="h-24 w-40 rounded object-cover" />
                  <Button
                    size="sm"
                    variant={video.isSelected ? "default" : "outline"}
                    onClick={() => selectVideo(video.id)}
                    disabled={video.isSelected}
                  >
                    {video.isSelected ? "Selected" : "Use this render"}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    aria-label="Delete final video"
                    onClick={() => deleteVideo(video.id)}
                    className="ml-auto"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 4 of 4 — Download &amp; Share</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!selectedVideo ? (
            <p className="text-xs text-muted-foreground">
              Assemble a final video above and pick &quot;Use this render&quot; to download or share it.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-foreground p-1.5">
              <video controls src={selectedVideo.url} className="h-24 w-40 rounded object-cover" />
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.open(`${selectedVideo.url}?download=1`, "_blank")}>
                    <Download className="size-3.5" />
                    Download
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copyLink(selectedVideo.url)}>
                    <Link2 className="size-3.5" />
                    Copy link
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedVideo.sizeBytes != null ? formatFileSize(selectedVideo.sizeBytes) : null}
                  {selectedVideo.sizeBytes != null ? " · " : null}
                  {new Date(selectedVideo.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmDialog}
    </>
  );
}
