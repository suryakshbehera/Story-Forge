"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelect, type ModelOption } from "@/components/model-select";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { Clapperboard, Save, Sparkles, Trash2, TriangleAlert, ChevronDown } from "lucide-react";
import { parseVideoModelConfig } from "@/lib/video-model-config";
import { planVideoSegments, splitFixedDurations } from "@/lib/video-segmentation";
import { groupIntoTakes, clipLabel, type SceneVideoClipItem, type VideoTake } from "@/lib/video-takes";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TermHint } from "@/components/term-hint";
import { isGenerationActive } from "@/lib/generation-claims";
import { GenerationErrorBanner, type GenerationErrorInfo } from "@/components/generation-error";
import { useGenerationEstimate, formatEstimate } from "@/lib/use-generation-estimate";
import {
  assembleVideoPrompt,
  EMPTY_PROMPT_BUILDER_FIELDS,
  PromptBuilderFieldsForm,
  type PromptBuilderFields,
} from "@/components/video-prompt-builder";

export type { SceneVideoClipItem };

// Motion prompt has an optional AI draft (draftMotionPrompt in
// lib/scene-video.ts, IMAGE_TO_VIDEO only) but stays a plain editable field
// otherwise — the AI only proposes structured builder fields into it, same
// "draft, don't auto-apply" idiom as duration's AI suggestion
// (recommendVideoDuration) below. videoPrompt (TEXT_TO_VIDEO) is user-written
// only, no draft step exists for it yet. IMAGE_TO_VIDEO
// generation always reads the *saved* scene image (isSelected) as the
// starting frame; this panel never lets the user override that per-call.
// TEXT_TO_VIDEO has no source image at all — motionPrompt and videoPrompt
// are kept as separate fields (see Scene.videoPrompt in schema.prisma) since
// one describes motion layered on an existing image and the other has to
// carry the whole shot on its own.
export function SceneVideoPanel({
  sceneId,
  mode,
  hasSelectedImage,
  shotCount,
  allShotsHaveImages,
  initialMotionPrompt,
  initialVideoPrompt,
  initialVideoDurationSeconds,
  initialVideoResolution,
  initialVideoGenerateAudio,
  initialVideoClips,
  initialVideoGenerationStartedAt,
  projectId,
  initialError,
}: {
  sceneId: string;
  mode: "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  hasSelectedImage: boolean;
  // Every shot becomes a keyframe under per-shot-pair generation, not just
  // the first — see the pair-count preview and canGenerate below.
  shotCount: number;
  allShotsHaveImages: boolean;
  initialMotionPrompt: string;
  initialVideoPrompt: string;
  initialVideoDurationSeconds: number | null;
  initialVideoResolution: string | null;
  initialVideoGenerateAudio: boolean;
  initialVideoClips: SceneVideoClipItem[];
  initialVideoGenerationStartedAt: string | null;
  projectId: string;
  // Durable failure from GenerationEvent (getActiveFailures), seeding
  // lastError below so a failure survives a reload — see ShotItem's
  // lastImageError for the same idea one level down.
  initialError?: GenerationErrorInfo | null;
}) {
  const [motionPrompt, setMotionPrompt] = useState(initialMotionPrompt);
  const [savedMotionPrompt, setSavedMotionPrompt] = useState(initialMotionPrompt);
  const [videoPrompt, setVideoPrompt] = useState(initialVideoPrompt);
  const [savedVideoPrompt, setSavedVideoPrompt] = useState(initialVideoPrompt);
  const [duration, setDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [savedDuration, setSavedDuration] = useState(initialVideoDurationSeconds?.toString() ?? "");
  const [resolution, setResolution] = useState(initialVideoResolution ?? "");
  const [savedResolution, setSavedResolution] = useState(initialVideoResolution ?? "");
  const [generateAudio, setGenerateAudio] = useState(initialVideoGenerateAudio);
  const [savedGenerateAudio, setSavedGenerateAudio] = useState(initialVideoGenerateAudio);
  const [saving, setSaving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  // Advisory-only tier-2 critic model — "" means "no override," which the
  // route resolves to whatever VIDEO_VALIDATION default is configured (or
  // skips the check entirely if none is). Same optional-override shape as
  // IMAGE_VALIDATION's picker in scene-manager.tsx.
  const [validationModelId, setValidationModelId] = useState("");
  const [generating, setGenerating] = useState(() => isGenerationActive(initialVideoGenerationStartedAt, "video"));
  const [videoClips, setVideoClips] = useState(initialVideoClips);
  const [lastError, setLastError] = useState<GenerationErrorInfo | null>(initialError ?? null);
  const unmountedRef = useRef(false);
  const [draftModelId, setDraftModelId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState<number | null>(null);
  const [durationModelId, setDurationModelId] = useState("");
  const [suggestingDuration, setSuggestingDuration] = useState(false);
  const [durationReason, setDurationReason] = useState("");
  const [retakingPairIndex, setRetakingPairIndex] = useState<number | null>(null);
  // Actual playable duration per clip, read off the <video> element itself
  // once its metadata loads — no backend field for this, the file already
  // carries it. Part of the per-clip generation-details disclosure below.
  const [clipDurations, setClipDurations] = useState<Record<string, number>>({});
  // Structured alternate input mode for motionPrompt/videoPrompt — same
  // fields/technique Seedance Studio uses, generalized (Phase 13). Purely a
  // UI-side helper: builderFields never gets read at save/generate time,
  // only used to compute the assembled string that's written into the same
  // motionPrompt/videoPrompt state the plain Textarea also writes to, so
  // save/generate/dirty-tracking below are all untouched by this.
  const [useBuilder, setUseBuilder] = useState(false);
  const [builderFields, setBuilderFields] = useState<PromptBuilderFields>(EMPTY_PROMPT_BUILDER_FIELDS);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => () => {
    unmountedRef.current = true;
  }, []);

  // Watches a generation claimed by someone/somewhen else — this tab before
  // a reload, or another tab — until it finishes, same contract as
  // shot-manager.tsx's pollUntilGenerationIdle.
  async function pollUntilGenerationIdle() {
    while (!unmountedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (unmountedRef.current) return;
      const res = await fetch(`/api/scenes/${sceneId}/status`).catch(() => null);
      if (!res?.ok) continue;
      const updated: { videoGenerationStartedAt: string | null; videoClips: SceneVideoClipItem[] } = await res.json();
      if (!isGenerationActive(updated.videoGenerationStartedAt, "video")) {
        if (!unmountedRef.current) {
          setVideoClips(updated.videoClips);
          setGenerating(false);
        }
        return;
      }
    }
  }

  // Mount-only: picks up a generation already in flight when this panel
  // first renders — must not re-run on every prop update.
  useEffect(() => {
    if (isGenerationActive(initialVideoGenerationStartedAt, "video")) pollUntilGenerationIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scenes/${sceneId}/voice-duration`)
      .then((res) => res.json())
      .then((data: { seconds: number | null }) => {
        if (!cancelled) setVoiceDurationSeconds(data.seconds);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const dirty =
    motionPrompt !== savedMotionPrompt ||
    videoPrompt !== savedVideoPrompt ||
    duration !== savedDuration ||
    resolution !== savedResolution ||
    generateAudio !== savedGenerateAudio;
  const canGenerate = mode === "TEXT_TO_VIDEO" || allShotsHaveImages;
  const pairCount = Math.max(shotCount - 1, shotCount === 1 ? 1 : 0);

  const selectedModel = models.find((m) => m.id === modelId);
  const modelConfig = parseVideoModelConfig(selectedModel?.config);
  const targetDuration = duration ? Number(duration) : voiceDurationSeconds;
  const segmentPlan = useMemo(
    () => (mode === "TEXT_TO_VIDEO" && targetDuration && targetDuration > 0 ? planVideoSegments(targetDuration, modelConfig) : null),
    [mode, targetDuration, modelConfig]
  );
  // Mirrors generateSceneVideo's own per-pair split (lib/scene-video.ts) so
  // this preview matches what Generate Video will actually produce, not
  // just a naive even division — see splitFixedDurations for why that
  // distinction matters for fixed-duration models.
  const pairSplitPreview = useMemo(() => {
    if (mode !== "IMAGE_TO_VIDEO" || pairCount === 0 || !targetDuration || targetDuration <= 0) return null;
    const perPair =
      modelConfig?.durationMode === "fixed"
        ? splitFixedDurations(targetDuration, pairCount, modelConfig.fixedDurations ?? [])
        : Array(pairCount).fill(targetDuration / pairCount);
    return { perPair, totalSeconds: perPair.reduce((a, b) => a + b, 0) };
  }, [mode, pairCount, targetDuration, modelConfig]);

  // How many separate clips Generate Video is actually about to produce —
  // used both for the estimate's "per clip" phrasing and to decide whether
  // this generation is big enough to warrant a confirm step below.
  const clipCount = mode === "IMAGE_TO_VIDEO" ? Math.max(pairCount, 1) : segmentPlan?.durations.length ?? 1;
  const estimate = useGenerationEstimate(projectId, "VIDEO_GENERATION", modelId || null);
  const estimateText = formatEstimate(estimate, "clip");

  async function save({ silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motionPrompt: motionPrompt || null,
          videoPrompt: videoPrompt || null,
          videoDurationSeconds: duration ? Number(duration) : null,
          videoResolution: resolution || null,
          videoGenerateAudio: generateAudio,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMotionPrompt(motionPrompt);
      setSavedVideoPrompt(videoPrompt);
      setSavedDuration(duration);
      setSavedResolution(resolution);
      setSavedGenerateAudio(generateAudio);
      if (!silent) toast.success("Motion settings saved.");
      return true;
    } catch {
      toast.error("Couldn't save motion settings.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (!modelId) {
      toast.error("Pick a video generation model first.");
      return;
    }
    // Only worth an extra click for a real multi-clip batch — a single clip
    // stays one-click so the common case doesn't gain friction.
    if (clipCount > 1) {
      const ok = await confirm({
        title: `Generate ${clipCount} clips?`,
        description: estimateText
          ? `This scene will generate ${clipCount} clips. Observed cost/time: ${estimateText}`
          : `This scene will generate ${clipCount} clips. No cost/time history yet for this model.`,
        confirmLabel: "Generate",
      });
      if (!ok) return;
    }
    if (dirty) {
      const ok = await save({ silent: true });
      if (!ok) return;
    }
    setGenerating(true);
    setLastError(null);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, validationModelId: validationModelId || undefined }),
      });
      if (res.status === 409) {
        toast.warning("Already generating for this scene — watching for it to finish.");
        pollUntilGenerationIdle();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error ?? "Generation failed";
        setLastError({ message, modelId: body.modelId, provider: body.provider });
        throw new Error(message);
      }
      const clips: SceneVideoClipItem[] = await res.json();
      setVideoClips((prev) => [...clips, ...prev.map((c) => ({ ...c, isSelected: false }))]);
      toast.success(
        mode === "IMAGE_TO_VIDEO" && clips.length > 1
          ? `${clips.length} clip${clips.length > 1 ? "s" : ""} generated across ${pairCount} shot pair${pairCount > 1 ? "s" : ""}.`
          : clips.length > 1
            ? `${clips.length} video segments generated.`
            : "Video clip generated."
      );
      setGenerating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
      setGenerating(false);
    }
  }

  async function draftPrompt() {
    if (!draftModelId) {
      toast.error("Pick a motion prompt drafting model first.");
      return;
    }
    setDrafting(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/motion-prompt/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: draftModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Drafting failed");
      }
      const fields: PromptBuilderFields = await res.json();
      setBuilderFields(fields);
      setMotionPrompt(assembleVideoPrompt(fields));
      toast.success("Motion prompt drafted — review and save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  }

  async function suggestDuration() {
    if (!durationModelId) {
      toast.error("Pick a duration recommendation model first.");
      return;
    }
    setSuggestingDuration(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video-duration/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: durationModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Suggestion failed");
      }
      const { durationSeconds, reason }: { durationSeconds: number; reason: string } = await res.json();
      setDuration(durationSeconds.toString());
      setDurationReason(reason);
      toast.success(`AI recommends ~${durationSeconds}s — review and save.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed.");
    } finally {
      setSuggestingDuration(false);
    }
  }

  async function selectTake(clipId: string) {
    const res = await fetch(`/api/scenes/${sceneId}/video/${clipId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select this take.");
      return;
    }
    const selectedBatch: SceneVideoClipItem[] = await res.json();
    const selectedIds = new Set(selectedBatch.map((c) => c.id));
    setVideoClips((prev) => prev.map((c) => ({ ...c, isSelected: selectedIds.has(c.id) })));
  }

  async function deleteTake(take: VideoTake) {
    const ok = await confirm({
      title: "Delete this take?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/scenes/${sceneId}/video/${take.clips[0].id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    const idsToRemove = new Set(take.clips.map((c) => c.id));
    setVideoClips((prev) => prev.filter((c) => !idsToRemove.has(c.id)));
  }

  // Regenerates just this one shot pair within the *selected* take, in place
  // — see regenerateScenePairVideo in lib/scene-video.ts. Pairs are
  // independent generation units, so a bad 6s pair inside a 45s scene
  // doesn't need the rest of the scene regenerated (and re-paid-for) to fix
  // it. Replaces the whole returned batch in state since the retake's own
  // segment order/count can differ from what it replaced.
  async function retakePair(pairIndex: number) {
    if (!modelId) {
      toast.error("Pick a video generation model first.");
      return;
    }
    setRetakingPairIndex(pairIndex);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video/pairs/${pairIndex}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, validationModelId: validationModelId || undefined }),
      });
      if (res.status === 409) {
        toast.warning("Already generating for this scene — try again once it finishes.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Retake failed");
      }
      const updatedBatch: SceneVideoClipItem[] = await res.json();
      const updatedBatchId = updatedBatch[0]?.batchId;
      setVideoClips((prev) => [...prev.filter((c) => c.batchId !== updatedBatchId), ...updatedBatch]);
      toast.success(`Shot ${pairIndex + 1}→${pairIndex + 2} retaken.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retake failed.");
    } finally {
      setRetakingPairIndex(null);
    }
  }

  const takes = groupIntoTakes(videoClips);
  const resolutionOptions = modelConfig?.resolutions ?? [];

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {mode === "IMAGE_TO_VIDEO" ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Motion prompt (camera/motion direction)</Label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={useBuilder} onCheckedChange={setUseBuilder} />
              Prompt builder
            </label>
          </div>
          {useBuilder ? (
            <div className="mt-1.5">
              <PromptBuilderFieldsForm
                fields={builderFields}
                onChange={(f) => {
                  setBuilderFields(f);
                  setMotionPrompt(assembleVideoPrompt(f));
                }}
                assembled={motionPrompt}
                savedPrompt={savedMotionPrompt || null}
              />
            </div>
          ) : (
            <Textarea
              rows={2}
              placeholder="e.g. slow push in, hair moves in the wind — falls back to the scene description if left blank"
              value={motionPrompt}
              onChange={(e) => setMotionPrompt(e.target.value)}
              className="mt-1.5"
            />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ModelSelect jobType="MOTION_PROMPT_DRAFTING" value={draftModelId} onChange={setDraftModelId} />
            <Button
              size="sm"
              variant="outline"
              onClick={draftPrompt}
              disabled={drafting || !hasSelectedImage}
              title={!hasSelectedImage ? "Select a first-shot image above first" : undefined}
            >
              <Sparkles className="size-3.5" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Reads the previous scene&apos;s generated clip (video + audio) and this scene&apos;s selected image to draft
            a continuity-aware motion prompt.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Video prompt (describes the whole shot, no source image)</Label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={useBuilder} onCheckedChange={setUseBuilder} />
              Prompt builder
            </label>
          </div>
          {useBuilder ? (
            <div className="mt-1.5">
              <PromptBuilderFieldsForm
                fields={builderFields}
                onChange={(f) => {
                  setBuilderFields(f);
                  setVideoPrompt(assembleVideoPrompt(f));
                }}
                assembled={videoPrompt}
                savedPrompt={savedVideoPrompt || null}
              />
            </div>
          ) : (
            <Textarea
              rows={2}
              placeholder="e.g. a lone figure walks through a neon-lit alley in the rain — falls back to the scene description if left blank"
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              className="mt-1.5"
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Duration (seconds, optional override)</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              type="number"
              min={1}
              className="w-24"
              placeholder="auto"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                setDurationReason("");
              }}
            />
            <ModelSelect jobType="DURATION_RECOMMENDATION" value={durationModelId} onChange={setDurationModelId} />
            <Button size="sm" variant="outline" onClick={suggestDuration} disabled={suggestingDuration}>
              <Sparkles className="size-3.5" />
              {suggestingDuration ? "Suggesting…" : "Suggest with AI"}
            </Button>
          </div>
        </div>
        {resolutionOptions.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground">Resolution</Label>
            <Select
              value={resolution || resolutionOptions[0]}
              onValueChange={(v) => v && setResolution(v)}
              items={Object.fromEntries(resolutionOptions.map((r) => [r, r]))}
            >
              <SelectTrigger className="mt-1.5 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resolutionOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <label className="mb-1.5 flex items-center gap-2 text-sm">
          <Switch checked={generateAudio} onCheckedChange={setGenerateAudio} />
          Native audio
        </label>
        <Button size="sm" variant="outline" onClick={() => save()} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {durationReason && <p className="text-xs text-muted-foreground">AI: {durationReason}</p>}

      {mode === "IMAGE_TO_VIDEO" && shotCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {shotCount === 1
            ? "1 shot → 1 clip (single-image animation, no end keyframe)."
            : pairSplitPreview
              ? `${shotCount} shots → ${pairCount} clip${pairCount > 1 ? "s" : ""} (${pairSplitPreview.perPair.map((d) => `${Math.round(d * 10) / 10}s`).join(" + ")} = ${Math.round(pairSplitPreview.totalSeconds * 10) / 10}s), one per consecutive shot pair.`
              : `${shotCount} shots → ${pairCount} clip${pairCount > 1 ? "s" : ""}, one per consecutive shot pair.`}
        </p>
      )}

      {segmentPlan && (
        <p className="text-xs text-muted-foreground">
          Suggested: {segmentPlan.durations.length} clip{segmentPlan.durations.length > 1 ? "s" : ""} (
          {segmentPlan.durations.map((d) => `${Math.round(d * 10) / 10}s`).join(" + ")} = {Math.round(segmentPlan.totalSeconds * 10) / 10}s)
          {selectedModel ? ` for ${selectedModel.displayName}` : ""}, based on{" "}
          {duration ? "the duration above" : `~${Math.round((voiceDurationSeconds ?? 0) * 10) / 10}s of scene audio`}.
        </p>
      )}

      {!canGenerate ? (
        <p className="text-xs text-muted-foreground">
          {mode === "IMAGE_TO_VIDEO"
            ? "Generate and select an image for every shot above first."
            : "Generate and select a scene image above first."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <ModelSelect jobType="VIDEO_GENERATION" value={modelId} onChange={setModelId} onModelsChange={setModels} />
            <ModelSelect
              jobType="VIDEO_VALIDATION"
              value={validationModelId}
              onChange={setValidationModelId}
              projectId={projectId}
            />
            <Button size="sm" onClick={generate} disabled={generating}>
              <Clapperboard className="size-3.5" />
              {generating ? "Generating…" : "Generate Video"}
            </Button>
          </div>
          {estimateText && <p className="text-xs text-muted-foreground">{estimateText}</p>}
        </div>
      )}

      {lastError && (
        <GenerationErrorBanner error={lastError} onRetry={generate} onDismiss={() => setLastError(null)} />
      )}

      {takes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Takes
            <TermHint text="Every generation is kept, not overwritten — pick whichever take looks best with &quot;Use this take&quot;. Only the selected take is used in the final render; the rest stay here to compare or fall back to." />
          </Label>
          {takes.map((take) => (
            <div key={take.key} className={`flex flex-col gap-1.5 rounded-md border p-1.5 ${take.isSelected ? "border-foreground" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                {take.clips.map((clip, i) => {
                  const isFirstOfPair = i === 0 || take.clips[i - 1].pairIndex !== clip.pairIndex;
                  return (
                    <div key={clip.id} className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <video
                          controls
                          src={clip.url}
                          className="h-24 w-40 rounded object-cover"
                          title={clipLabel(take.clips, i)}
                          onLoadedMetadata={(e) => {
                            const seconds = e.currentTarget.duration;
                            if (Number.isFinite(seconds)) setClipDurations((prev) => ({ ...prev, [clip.id]: seconds }));
                          }}
                        />
                        {clip.qcPassed === false && (
                          <span
                            className="absolute right-1 top-1 rounded-full bg-amber-500 p-0.5 text-white"
                            title={clip.qcNotes ?? "Auto-QC flagged this clip as possibly frozen/near-static — consider retaking it."}
                          >
                            <TriangleAlert className="size-3" />
                          </span>
                        )}
                        {clip.validationPassed === false && (
                          <span
                            className="absolute left-1 top-1 rounded-full bg-rose-600 p-0.5 text-white"
                            title={
                              clip.validationNotes ??
                              "Video validation flagged this clip — likely a face/identity, reference, continuity, or motion mismatch. Consider retaking it."
                            }
                          >
                            <TriangleAlert className="size-3" />
                          </span>
                        )}
                      </div>
                      {mode === "IMAGE_TO_VIDEO" && take.isSelected && clip.pairIndex != null && isFirstOfPair && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-xs"
                          disabled={retakingPairIndex !== null}
                          onClick={() => retakePair(clip.pairIndex!)}
                        >
                          {retakingPairIndex === clip.pairIndex ? "Retaking…" : "Retake this pair"}
                        </Button>
                      )}
                      <Collapsible className="w-40">
                        <CollapsibleTrigger className="flex w-full items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                          Details
                          <ChevronDown className="size-2.5" />
                        </CollapsibleTrigger>
                        <CollapsiblePanel>
                          <div className="mt-1 flex flex-col gap-0.5 rounded bg-muted/50 p-1.5 text-[10px] text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">Model:</span> {clip.modelId ?? "—"}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Duration:</span>{" "}
                              {clipDurations[clip.id] != null ? `${clipDurations[clip.id].toFixed(1)}s` : "…"}
                            </div>
                            {mode === "IMAGE_TO_VIDEO" && (
                              <div>
                                <span className="font-medium text-foreground">End-frame used:</span>{" "}
                                {clip.usedEndFrame == null ? "n/a" : clip.usedEndFrame ? "Yes" : "No"}
                              </div>
                            )}
                            {clip.qcNotes && (
                              <div>
                                <span className="font-medium text-foreground">QC:</span> {clip.qcNotes}
                              </div>
                            )}
                            {clip.validationNotes && (
                              <div>
                                <span className="font-medium text-foreground">Validation:</span> {clip.validationNotes}
                              </div>
                            )}
                            {clip.prompt && (
                              <div className="whitespace-pre-wrap break-words">
                                <span className="font-medium text-foreground">Prompt:</span> {clip.prompt}
                              </div>
                            )}
                          </div>
                        </CollapsiblePanel>
                      </Collapsible>
                    </div>
                  );
                })}
                <Button size="sm" variant={take.isSelected ? "default" : "outline"} onClick={() => selectTake(take.clips[0].id)} disabled={take.isSelected}>
                  {take.isSelected ? "Selected" : "Use this take"}
                </Button>
                <Button size="icon-sm" variant="destructive" aria-label="Delete video take" onClick={() => deleteTake(take)} className="ml-auto">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {take.clips.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {mode === "IMAGE_TO_VIDEO"
                    ? `${take.clips.length} clips across shot pairs, in order.`
                    : `${take.clips.length} frame-chained segments, in order.`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
