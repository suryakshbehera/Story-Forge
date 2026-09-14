"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isImageGenerationActive } from "@/lib/shot-image-generation";
import { effectiveShotSeconds, illustrationTimingMismatch } from "@/lib/illustration-timing";
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
  ChevronRight,
  Clapperboard,
  ImagePlus,
  Upload,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import type { CameraMovementValue } from "@/lib/video-model-config";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TermHint } from "@/components/term-hint";
import { getModelsForJobType } from "@/lib/model-registry-cache";
import type { ModelOption } from "@/components/model-select";
import { GenerationErrorBanner, type GenerationErrorInfo } from "@/components/generation-error";

// Re-exported from the shared list rather than redeclared, so this dropdown
// can't drift from what SHOT_PLANNING is allowed to draft (it used to be its
// own hand-written union, which is exactly how a value ends up draftable but
// not selectable, or vice versa).
export type CameraMovement = CameraMovementValue;

// Labels name the real distinction where it's easy to confuse — a dolly is
// not a zoom, a track is not a pan — since this dropdown is where a user
// overrides the Director's choice by hand.
const CAMERA_MOVEMENT_LABELS: Record<CameraMovement, string> = {
  STATIC: "None (static)",
  ZOOM_IN: "Zoom in (optical)",
  ZOOM_OUT: "Zoom out (optical)",
  CRASH_ZOOM: "Crash zoom (fast)",
  DOLLY_IN: "Dolly in (push toward)",
  DOLLY_OUT: "Dolly out (pull back)",
  DOLLY_ZOOM: "Dolly zoom (Vertigo effect)",
  PAN_LEFT: "Pan left (pivot)",
  PAN_RIGHT: "Pan right (pivot)",
  WHIP_PAN: "Whip pan (fast, blurred)",
  TILT_UP: "Tilt up (pivot)",
  TILT_DOWN: "Tilt down (pivot)",
  ROLL: "Roll (horizon rotates)",
  TRACK_LEFT: "Track left (travel)",
  TRACK_RIGHT: "Track right (travel)",
  PEDESTAL_UP: "Pedestal up (body rises)",
  PEDESTAL_DOWN: "Pedestal down (body drops)",
  CRANE_UP: "Crane up (sweeping rise)",
  CRANE_DOWN: "Crane down (sweeping descent)",
  ARC_LEFT: "Arc left (orbit)",
  ARC_RIGHT: "Arc right (orbit)",
  STEADICAM_FOLLOW: "Steadicam follow (smooth)",
  HANDHELD: "Handheld (unsteady)",
  AERIAL: "Aerial / drone (from above)",
};

// ── Director AI cinematography ───────────────────────────────────────────
// Mirrors the Prisma enums (schema.prisma) and the prose labels in
// lib/shot-images.ts. Every one of these is nullable end to end: "Not set"
// is a real, common, correct value meaning the Director made no deliberate
// choice on that axis, and the image prompt then says nothing about it.
export type ShotSize = "EXTREME_WIDE" | "WIDE" | "FULL" | "MEDIUM" | "MEDIUM_CLOSE_UP" | "CLOSE_UP" | "EXTREME_CLOSE_UP";
export type CameraAngle = "EYE_LEVEL" | "LOW" | "HIGH" | "OVERHEAD" | "DUTCH" | "OVER_THE_SHOULDER" | "POV";
export type ShotFraming = "SINGLE" | "TWO_SHOT" | "THREE_SHOT" | "GROUP" | "INSERT" | "ESTABLISHING";
export type DepthOfField = "SHALLOW" | "MEDIUM" | "DEEP";
export type LightingStyle =
  | "NATURAL"
  | "SOFT"
  | "HARD"
  | "HIGH_KEY"
  | "LOW_KEY"
  | "BACKLIT"
  | "SILHOUETTE"
  | "GOLDEN_HOUR"
  | "MOONLIT"
  | "PRACTICAL";
export type ShotComposition =
  | "CENTERED"
  | "RULE_OF_THIRDS"
  | "SYMMETRICAL"
  | "LEADING_LINES"
  | "FRAME_WITHIN_FRAME"
  | "NEGATIVE_SPACE"
  | "DIAGONAL";

const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  EXTREME_WIDE: "Extreme wide",
  WIDE: "Wide",
  FULL: "Full",
  MEDIUM: "Medium",
  MEDIUM_CLOSE_UP: "Medium close-up",
  CLOSE_UP: "Close-up",
  EXTREME_CLOSE_UP: "Extreme close-up",
};
const CAMERA_ANGLE_LABELS: Record<CameraAngle, string> = {
  EYE_LEVEL: "Eye level",
  LOW: "Low angle",
  HIGH: "High angle",
  OVERHEAD: "Overhead",
  DUTCH: "Dutch (canted)",
  OVER_THE_SHOULDER: "Over the shoulder",
  POV: "POV",
};
const SHOT_FRAMING_LABELS: Record<ShotFraming, string> = {
  SINGLE: "Single",
  TWO_SHOT: "Two-shot",
  THREE_SHOT: "Three-shot",
  GROUP: "Group",
  INSERT: "Insert",
  ESTABLISHING: "Establishing",
};
const DEPTH_OF_FIELD_LABELS: Record<DepthOfField, string> = {
  SHALLOW: "Shallow",
  MEDIUM: "Medium",
  DEEP: "Deep",
};
const LIGHTING_STYLE_LABELS: Record<LightingStyle, string> = {
  NATURAL: "Natural",
  SOFT: "Soft",
  HARD: "Hard",
  HIGH_KEY: "High key",
  LOW_KEY: "Low key",
  BACKLIT: "Backlit",
  SILHOUETTE: "Silhouette",
  GOLDEN_HOUR: "Golden hour",
  MOONLIT: "Moonlit",
  PRACTICAL: "Practical",
};
const SHOT_COMPOSITION_LABELS: Record<ShotComposition, string> = {
  CENTERED: "Centered",
  RULE_OF_THIRDS: "Rule of thirds",
  SYMMETRICAL: "Symmetrical",
  LEADING_LINES: "Leading lines",
  FRAME_WITHIN_FRAME: "Frame within frame",
  NEGATIVE_SPACE: "Negative space",
  DIAGONAL: "Diagonal",
};

// ── Director AI emotion ───────────────────────────────────────────────────
// Same nullable-everywhere contract as cinematography above, one axis over
// (see lib/emotion.ts and schema.prisma's Emotion/EmotionIntensity enums).
export type Emotion =
  | "JOY"
  | "LOVE"
  | "HOPE"
  | "PRIDE"
  | "RELIEF"
  | "SADNESS"
  | "GRIEF"
  | "LONELINESS"
  | "DESPAIR"
  | "NOSTALGIA"
  | "ANGER"
  | "RAGE"
  | "FRUSTRATION"
  | "RESENTMENT"
  | "FEAR"
  | "ANXIETY"
  | "DREAD"
  | "PANIC"
  | "SURPRISE"
  | "SHOCK"
  | "AWE"
  | "CONFUSION"
  | "CURIOSITY"
  | "SHAME"
  | "GUILT"
  | "JEALOUSY"
  | "BETRAYAL"
  | "DESIRE"
  | "DETERMINATION"
  | "COURAGE"
  | "DEFIANCE"
  | "TRIUMPH"
  | "SUSPENSE"
  | "CALM"
  | "DOUBT"
  | "EXHAUSTION";
export type EmotionIntensity = "SUBTLE" | "MODERATE" | "INTENSE";

const EMOTION_LABELS: Record<Emotion, string> = {
  JOY: "Joy",
  LOVE: "Love",
  HOPE: "Hope",
  PRIDE: "Pride",
  RELIEF: "Relief",
  SADNESS: "Sadness",
  GRIEF: "Grief",
  LONELINESS: "Loneliness",
  DESPAIR: "Despair",
  NOSTALGIA: "Nostalgia",
  ANGER: "Anger",
  RAGE: "Rage",
  FRUSTRATION: "Frustration",
  RESENTMENT: "Resentment",
  FEAR: "Fear",
  ANXIETY: "Anxiety",
  DREAD: "Dread",
  PANIC: "Panic",
  SURPRISE: "Surprise",
  SHOCK: "Shock",
  AWE: "Awe",
  CONFUSION: "Confusion",
  CURIOSITY: "Curiosity",
  SHAME: "Shame",
  GUILT: "Guilt",
  JEALOUSY: "Jealousy",
  BETRAYAL: "Betrayal",
  DESIRE: "Desire",
  DETERMINATION: "Determination",
  COURAGE: "Courage",
  DEFIANCE: "Defiance",
  TRIUMPH: "Triumph",
  SUSPENSE: "Suspense",
  CALM: "Calm",
  DOUBT: "Doubt",
  EXHAUSTION: "Exhaustion",
};
const EMOTION_INTENSITY_LABELS: Record<EmotionIntensity, string> = {
  SUBTLE: "Subtle",
  MODERATE: "Moderate",
  INTENSE: "Intense",
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
  // AI-drafted at Generate Shots time, user-editable after — state that
  // carries forward from THIS shot into the next one's image generation
  // (props picked up/dropped, wardrobe/physical changes). See
  // shot-images.ts's loadPreviousShot/buildContinuityBlock.
  continuityNotes: string | null;
  cameraMovement: CameraMovement;
  // Director AI cinematography — AI-drafted at Generate Shots / Direct this
  // scene time, user-editable in the Cinematography block below. null means
  // "no deliberate choice", not "default": the image prompt stays silent on
  // that axis rather than asserting a bland value.
  shotSize: ShotSize | null;
  lensMm: number | null;
  cameraAngle: CameraAngle | null;
  framing: ShotFraming | null;
  depthOfField: DepthOfField | null;
  focusPoint: string | null;
  lightingStyle: LightingStyle | null;
  composition: ShotComposition | null;
  subjectMovement: string | null;
  // Director AI emotion — same AI-drafted/user-editable contract as
  // cinematography above, in the Performance block below.
  emotion: Emotion | null;
  emotionIntensity: EmotionIntensity | null;
  facialExpression: string | null;
  bodyLanguage: string | null;
  durationSeconds: number | null;
  // IMAGE_TO_VIDEO only — manual override of which VIDEO_GENERATION model
  // generates this shot's pair (shot[i]->shot[i+1]). null = no override, use
  // the CameraMovement-based preferred-model rule, then the scene's default.
  videoModelId: string | null;
  images: ShotImageItem[];
  // Non-null and recent means a generation is genuinely in flight (this tab,
  // another tab, or before a reload) — see lib/shot-image-generation.ts for
  // the staleness rule that keeps this from being read as "generating"
  // forever if the server died mid-request.
  imageGenerationStartedAt: string | null;
  // Seeds imageLastError below from durable GenerationEvent data (see
  // lib/generation-events.ts's getActiveFailures) so a failed image
  // generation survives a reload instead of vanishing once its toast does —
  // undefined on any response that isn't the initial page load (a live
  // generate() failure already sets imageLastError directly).
  lastImageError?: GenerationErrorInfo | null;
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
  unmatchedNames,
  onShotsChange,
}: {
  sceneId: string;
  sceneVisualMode: "ILLUSTRATION" | "IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO";
  initialShots: ShotItem[];
  promptModelId: string;
  imageModelId: string;
  validationModelId: string;
  imageInstructions: string;
  shotPlanningModelId: string;
  // Names the AI mentioned in this scene's own text (from the last Generate
  // Scenes pass) that don't match a tagged Character/Location yet — see
  // SceneManager's sceneUnmatchedNames. Empty/undefined means none; gates
  // generateShots below with a confirm, since shots planned now won't get
  // continuity/reference-image context for whatever these names refer to.
  unmatchedNames?: string[];
  // Shots live in this component's own state (image generation/selection
  // happens per-shot below, never round-tripping through the parent scene
  // object) — reported up so SceneManager's copy of scene.shots doesn't go
  // stale for anything that gates on it, e.g. SceneVideoPanel's "every shot
  // needs a selected image" check.
  onShotsChange?: (shots: ShotItem[]) => void;
}) {
  const [shots, setShots] = useState(initialShots);
  const [planning, setPlanning] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState<number | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    onShotsChange?.(shots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots]);

  // Mirrors SceneVideoPanel's own voice-duration fetch — same endpoint, same
  // "fetch once on mount" idiom. Only meaningful for ILLUSTRATION, where
  // shot durations are the picture's own timing rather than a slice of this
  // (see lib/illustration-timing.ts for why the two can drift apart).
  useEffect(() => {
    if (sceneVisualMode !== "ILLUSTRATION") return;
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
  }, [sceneId, sceneVisualMode]);

  const shotsTotalSeconds = useMemo(
    () => shots.reduce((sum, s) => sum + effectiveShotSeconds(s.durationSeconds), 0),
    [shots]
  );
  const timingMismatch =
    sceneVisualMode === "ILLUSTRATION" && voiceDurationSeconds != null && shots.length > 0
      ? illustrationTimingMismatch(shotsTotalSeconds, voiceDurationSeconds)
      : false;

  async function generateShots() {
    if (!shotPlanningModelId) {
      toast.error("Pick a Shot Planning model first.");
      return;
    }
    if (unmatchedNames && unmatchedNames.length > 0) {
      const ok = await confirm({
        title: "This scene mentions untagged characters/locations",
        description: `"${unmatchedNames.join('", "')}" ${unmatchedNames.length > 1 ? "aren't" : "isn't"} tagged as a Character or Location yet, so shots planned now won't get continuity or reference-image context for ${unmatchedNames.length > 1 ? "them" : "it"}. Add ${unmatchedNames.length > 1 ? "them" : "it"} in Characters/Locations and tag this scene first, or continue anyway.`,
        confirmLabel: "Generate Anyway",
      });
      if (!ok) return;
    }
    const regenerateAll = shots.length > 0;
    if (regenerateAll) {
      const ok = await confirm({
        title: "Regenerate all shots?",
        description: `This deletes all ${shots.length} existing shot(s) and their images before generating new ones. This can't be undone.`,
        confirmLabel: "Regenerate",
        destructive: true,
      });
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

  // Cinematography-only pass over the shots that already exist — unlike
  // Regenerate Shots, this destroys nothing (no deletes, no re-descriptions,
  // images untouched), so it needs no confirm. It's how pre-Director shots,
  // and any shot added by hand, get their camera fields filled in.
  async function directShots() {
    if (!shotPlanningModelId) {
      toast.error("Pick a Shot Planning model first.");
      return;
    }
    setDirecting(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/shots/direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: shotPlanningModelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Directing failed");
      }
      const data: { shots: ShotItem[]; reason: string | null } = await res.json();
      setShots(data.shots);
      toast.success(data.reason ? `Directed ${data.shots.length} shot(s) — ${data.reason}` : `Directed ${data.shots.length} shot(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Directing failed.");
    } finally {
      setDirecting(false);
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
        {shots.length > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={planning} onClick={generateShots}>
              <Sparkles className="size-3.5" />
              {planning ? "Planning…" : "Regenerate Shots"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={directing}
              onClick={directShots}
              title="Fill in the cinematography (shot size, lens, angle, lighting, composition) for every existing shot in one pass. Doesn't change descriptions, continuity or images."
            >
              <Clapperboard className="size-3.5" />
              {directing ? "Directing…" : "Direct this scene"}
            </Button>
            <Button size="sm" variant="outline" disabled={adding} onClick={addShot}>
              <Plus className="size-3.5" />
              Add Shot
            </Button>
          </div>
        )}
      </div>

      {sceneVisualMode === "ILLUSTRATION" && shots.length > 0 && (
        <p className={cn("text-xs", timingMismatch ? "text-amber-600" : "text-muted-foreground")}>
          Shots total {shotsTotalSeconds.toFixed(1)}s
          {voiceDurationSeconds != null && `, narration/dialogue audio is ${voiceDurationSeconds.toFixed(1)}s`}
          {timingMismatch &&
            " — Final Assembly stretches or compresses every shot by the same ratio to land on the voice exactly, so this won't break, but a gap this big means the actual pacing will look noticeably slower or faster than what's set below. Adjust shot durations above for better pacing, or fit narration to the picture via Assemble without Audio → Audio Cue Plan."}
        </p>
      )}

      {shots.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">No shots yet —</p>
          <Button size="sm" variant="outline" disabled={planning} onClick={generateShots}>
            <Sparkles className="size-3.5" />
            {planning ? "Planning…" : "Generate Shots"}
          </Button>
          <Button size="sm" variant="outline" disabled={adding} onClick={addShot}>
            <Plus className="size-3.5" />
            Add Shot
          </Button>
        </div>
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
      {ConfirmDialog}
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
  const [continuityNotes, setContinuityNotes] = useState(shot.continuityNotes ?? "");
  const [cameraMovement, setCameraMovement] = useState<CameraMovement>(shot.cameraMovement);
  // Cinematography: enums held as `T | null` (null = "Not set"), lensMm as a
  // string like every other numeric input here so an empty box stays empty
  // rather than becoming 0.
  const [shotSize, setShotSize] = useState<ShotSize | null>(shot.shotSize);
  const [lensMm, setLensMm] = useState(shot.lensMm?.toString() ?? "");
  const [cameraAngle, setCameraAngle] = useState<CameraAngle | null>(shot.cameraAngle);
  const [framing, setFraming] = useState<ShotFraming | null>(shot.framing);
  const [depthOfField, setDepthOfField] = useState<DepthOfField | null>(shot.depthOfField);
  const [focusPoint, setFocusPoint] = useState(shot.focusPoint ?? "");
  const [lightingStyle, setLightingStyle] = useState<LightingStyle | null>(shot.lightingStyle);
  const [composition, setComposition] = useState<ShotComposition | null>(shot.composition);
  const [subjectMovement, setSubjectMovement] = useState(shot.subjectMovement ?? "");
  const [cinematographyOpen, setCinematographyOpen] = useState(false);
  const [emotion, setEmotion] = useState<Emotion | null>(shot.emotion);
  const [emotionIntensity, setEmotionIntensity] = useState<EmotionIntensity | null>(shot.emotionIntensity);
  const [facialExpression, setFacialExpression] = useState(shot.facialExpression ?? "");
  const [bodyLanguage, setBodyLanguage] = useState(shot.bodyLanguage ?? "");
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(shot.durationSeconds?.toString() ?? "");
  const [videoModelId, setVideoModelId] = useState(shot.videoModelId ?? "");
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(() => isImageGenerationActive(shot.imageGenerationStartedAt));
  const [imageUploading, setImageUploading] = useState(false);
  const [imageLastError, setImageLastError] = useState<GenerationErrorInfo | null>(shot.lastImageError ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unmountedRef = useRef(false);
  const { confirm, ConfirmDialog } = useConfirm();
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
    continuityNotes !== (shot.continuityNotes ?? "") ||
    cameraMovement !== shot.cameraMovement ||
    shotSize !== shot.shotSize ||
    lensMm !== (shot.lensMm?.toString() ?? "") ||
    cameraAngle !== shot.cameraAngle ||
    framing !== shot.framing ||
    depthOfField !== shot.depthOfField ||
    focusPoint !== (shot.focusPoint ?? "") ||
    lightingStyle !== shot.lightingStyle ||
    composition !== shot.composition ||
    subjectMovement !== (shot.subjectMovement ?? "") ||
    emotion !== shot.emotion ||
    emotionIntensity !== shot.emotionIntensity ||
    facialExpression !== (shot.facialExpression ?? "") ||
    bodyLanguage !== (shot.bodyLanguage ?? "") ||
    durationSeconds !== (shot.durationSeconds?.toString() ?? "") ||
    videoModelId !== (shot.videoModelId ?? "");

  // A "Direct this scene" pass (or a Regenerate) replaces this card's shot
  // prop wholesale — the local fields have to re-seed from it, or the inputs
  // would keep showing pre-direction values until a reload. Done as a
  // render-phase adjustment rather than an effect (React's documented
  // "adjusting state when a prop changes" pattern): an effect here would
  // cascade an extra render per card, which react-hooks/set-state-in-effect
  // rejects. Keyed on the server's own nine values, so an unrelated
  // re-render (a newly generated image arriving, say) can't clobber a
  // half-typed edit.
  const cinematographySignature = JSON.stringify([
    shot.shotSize,
    shot.lensMm,
    shot.cameraAngle,
    shot.framing,
    shot.depthOfField,
    shot.focusPoint,
    shot.lightingStyle,
    shot.composition,
    shot.subjectMovement,
  ]);
  const [syncedCinematography, setSyncedCinematography] = useState(cinematographySignature);
  if (syncedCinematography !== cinematographySignature) {
    setSyncedCinematography(cinematographySignature);
    setShotSize(shot.shotSize);
    setLensMm(shot.lensMm?.toString() ?? "");
    setCameraAngle(shot.cameraAngle);
    setFraming(shot.framing);
    setDepthOfField(shot.depthOfField);
    setFocusPoint(shot.focusPoint ?? "");
    setLightingStyle(shot.lightingStyle);
    setComposition(shot.composition);
    setSubjectMovement(shot.subjectMovement ?? "");
  }

  // Same re-seed contract as cinematographySignature above, one axis over —
  // a "Direct this scene" pass replaces emotion fields wholesale too.
  const emotionSignature = JSON.stringify([shot.emotion, shot.emotionIntensity, shot.facialExpression, shot.bodyLanguage]);
  const [syncedEmotion, setSyncedEmotion] = useState(emotionSignature);
  if (syncedEmotion !== emotionSignature) {
    setSyncedEmotion(emotionSignature);
    setEmotion(shot.emotion);
    setEmotionIntensity(shot.emotionIntensity);
    setFacialExpression(shot.facialExpression ?? "");
    setBodyLanguage(shot.bodyLanguage ?? "");
  }

  // Shown on the collapsed trigger so a directed shot is distinguishable
  // from an undirected one without opening the block.
  const directedFieldCount = [
    shotSize,
    lensMm.trim() || null,
    cameraAngle,
    framing,
    depthOfField,
    focusPoint.trim() || null,
    lightingStyle,
    composition,
    subjectMovement.trim() || null,
  ].filter(Boolean).length;
  const directedEmotionFieldCount = [emotion, emotionIntensity, facialExpression.trim() || null, bodyLanguage.trim() || null].filter(
    Boolean
  ).length;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          continuityNotes: continuityNotes.trim() || null,
          cameraMovement,
          shotSize,
          lensMm: lensMm ? Number(lensMm) : null,
          cameraAngle,
          framing,
          depthOfField,
          focusPoint: focusPoint.trim() || null,
          lightingStyle,
          composition,
          subjectMovement: subjectMovement.trim() || null,
          emotion,
          emotionIntensity,
          facialExpression: facialExpression.trim() || null,
          bodyLanguage: bodyLanguage.trim() || null,
          durationSeconds: durationSeconds ? Number(durationSeconds) : null,
          videoModelId: videoModelId || null,
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
    const ok = await confirm({
      title: `Delete shot ${shot.order}?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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
    setImageLastError(null);
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
        const message = body.error ?? "Image generation failed.";
        setImageLastError({ message, modelId: body.modelId, provider: body.provider });
        throw new Error(message);
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
    const ok = await confirm({
      title: "Delete this image?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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
        <CardTitle className="flex items-center gap-1.5 text-sm">
          Shot {shot.order}
          {isFirst && (
            <TermHint text="Each shot is its own continuity frame, not an alternate of the others — shot 2 continues the scene from shot 1, it never re-generates the same moment. Alternates only exist within one shot's own image gallery below." />
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Move shot up" disabled={isFirst || moving} onClick={() => move("up")}>
            <ChevronUp className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Move shot down" disabled={isLast || moving} onClick={() => move("down")}>
            <ChevronDown className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="destructive" aria-label="Delete shot" disabled={deleting} onClick={remove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 py-0 pb-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Description (what&apos;s on screen)</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid gap-1.5">
          <Label className="flex items-center gap-1 text-xs text-muted-foreground">
            Continuity notes (optional)
            <TermHint text="What changes by the end of this shot — a prop picked up, a wardrobe or physical change. AI drafts this when shots are generated; it's automatically read into the NEXT shot's image generation, and you can edit it here." />
          </Label>
          <Textarea
            rows={2}
            placeholder="e.g. Arjun is now holding the iron sword in his right hand"
            value={continuityNotes}
            onChange={(e) => setContinuityNotes(e.target.value)}
          />
        </div>

        <Collapsible open={cinematographyOpen} onOpenChange={setCinematographyOpen}>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            Cinematography
            {directedFieldCount > 0 && <span className="text-muted-foreground">({directedFieldCount} set)</span>}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="flex flex-col gap-2.5 pt-2.5">
              <p className="text-xs text-muted-foreground">
                How this shot is photographed. AI fills these in when shots are generated, or via &ldquo;Direct this
                scene&rdquo;. Anything left as &ldquo;Not set&rdquo; is left to the image model — that&apos;s a valid
                choice, not a gap to fill.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Shot size</Label>
                  <NullableEnumSelect labels={SHOT_SIZE_LABELS} value={shotSize} onChange={setShotSize} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Camera angle</Label>
                  <NullableEnumSelect labels={CAMERA_ANGLE_LABELS} value={cameraAngle} onChange={setCameraAngle} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Framing</Label>
                  <NullableEnumSelect labels={SHOT_FRAMING_LABELS} value={framing} onChange={setFraming} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Lens (mm)</Label>
                  <Input
                    type="number"
                    min={8}
                    max={300}
                    className="w-24"
                    placeholder="auto"
                    value={lensMm}
                    onChange={(e) => setLensMm(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Depth of field</Label>
                  <NullableEnumSelect labels={DEPTH_OF_FIELD_LABELS} value={depthOfField} onChange={setDepthOfField} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Lighting
                    <TermHint text="Lighting normally holds across a whole scene — change it on one shot only when the story does (a door opens, a lamp is snuffed, time passes), or the cut will read as a jump." />
                  </Label>
                  <NullableEnumSelect labels={LIGHTING_STYLE_LABELS} value={lightingStyle} onChange={setLightingStyle} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Composition</Label>
                  <NullableEnumSelect labels={SHOT_COMPOSITION_LABELS} value={composition} onChange={setComposition} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Focus point (optional)</Label>
                <Input
                  placeholder="e.g. Arjun's hands on the hilt"
                  value={focusPoint}
                  onChange={(e) => setFocusPoint(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Subject movement (optional)
                  <TermHint text="What the subjects do inside the frame, including screen direction — not what the camera does. Keeping screen direction consistent across shots is what stops a scene from flipping sides on a cut." />
                </Label>
                <Input
                  placeholder="e.g. Arjun strides in from frame-left and stops at centre"
                  value={subjectMovement}
                  onChange={(e) => setSubjectMovement(e.target.value)}
                />
              </div>
            </div>
          </CollapsiblePanel>
        </Collapsible>

        <Collapsible open={performanceOpen} onOpenChange={setPerformanceOpen}>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            Performance
            {directedEmotionFieldCount > 0 && <span className="text-muted-foreground">({directedEmotionFieldCount} set)</span>}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="flex flex-col gap-2.5 pt-2.5">
              <p className="text-xs text-muted-foreground">
                The emotional beat of this shot. AI fills these in when shots are generated, or via &ldquo;Direct this
                scene&rdquo;. Anything left as &ldquo;Not set&rdquo; is left to the image model.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Emotion</Label>
                  <NullableEnumSelect labels={EMOTION_LABELS} value={emotion} onChange={setEmotion} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Intensity</Label>
                  <NullableEnumSelect labels={EMOTION_INTENSITY_LABELS} value={emotionIntensity} onChange={setEmotionIntensity} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Facial expression (optional)</Label>
                <Input
                  placeholder="e.g. jaw tight, eyes narrowed"
                  value={facialExpression}
                  onChange={(e) => setFacialExpression(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Body language (optional)</Label>
                <Input
                  placeholder="e.g. shoulders drawn in, arms crossed protectively"
                  value={bodyLanguage}
                  onChange={(e) => setBodyLanguage(e.target.value)}
                />
              </div>
            </div>
          </CollapsiblePanel>
        </Collapsible>

        <div className="flex flex-wrap items-end gap-3">
          {sceneVisualMode === "ILLUSTRATION" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Camera Movement</Label>
              <CameraMovementSelect value={cameraMovement} onChange={setCameraMovement} />
            </div>
          )}
          {sceneVisualMode === "IMAGE_TO_VIDEO" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Video model (optional override)</Label>
              <ShotVideoModelSelect value={videoModelId} onChange={setVideoModelId} />
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
                <button
                  type="button"
                  onClick={() => selectImage(img.id)}
                  aria-pressed={img.isSelected}
                  aria-label={`Use this image for shot ${shot.order}`}
                  title={img.validationNotes ?? undefined}
                  className={cn(
                    "cursor-pointer overflow-hidden rounded-md border-2",
                    img.isSelected ? "border-foreground" : "border-transparent"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Shot ${shot.order} image`} className="h-24 w-40 object-cover" />
                </button>
                <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-background/80 p-0.5">
                  {img.validationPassed === true && <CheckCircle2 className="size-3.5 text-green-600" />}
                  {img.validationPassed === false && <XCircle className="size-3.5 text-amber-600" />}
                  {img.validationPassed === null && <HelpCircle className="size-3.5 text-muted-foreground" />}
                </span>
                <button
                  type="button"
                  onClick={() => deleteImage(img.id)}
                  aria-label="Delete image"
                  className="absolute left-1 top-1 hidden rounded-full bg-background/80 p-0.5 group-hover:block group-focus-within:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {imageLastError && (
          <GenerationErrorBanner
            error={imageLastError}
            onRetry={generateImage}
            onDismiss={() => setImageLastError(null)}
          />
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
      {ConfirmDialog}
    </Card>
  );
}

// Same shape as CameraMovementSelect, but for the cinematography enums,
// where null is a first-class value. Uses a sentinel option rather than an
// empty string for the same reason ShotVideoModelSelect does — base-ui's
// Select treats "" as no-selection and would render an empty trigger instead
// of the "Not set" label.
const NOT_SET_VALUE = "__not_set__";

function NullableEnumSelect<T extends string>({
  labels,
  value,
  onChange,
  className = "w-44",
}: {
  labels: Record<T, string>;
  value: T | null;
  onChange: (v: T | null) => void;
  className?: string;
}) {
  const items: Record<string, string> = { [NOT_SET_VALUE]: "Not set" };
  for (const key of Object.keys(labels) as T[]) items[key] = labels[key];

  return (
    <Select
      value={value ?? NOT_SET_VALUE}
      onValueChange={(v) => v && onChange(v === NOT_SET_VALUE ? null : (v as T))}
      items={items}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET_VALUE}>Not set</SelectItem>
        {(Object.keys(labels) as T[]).map((key) => (
          <SelectItem key={key} value={key}>
            {labels[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CameraMovementSelect({ value, onChange }: { value: CameraMovement; onChange: (v: CameraMovement) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as CameraMovement)} items={CAMERA_MOVEMENT_LABELS}>
      <SelectTrigger className="w-52">
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

// Deliberately not @/components/model-select's ModelSelect — that component
// auto-picks a fallback model whenever `value` is empty, which is right for
// a required "which model generates this" field but wrong here: empty must
// stay empty, meaning "no override, use the scene's CameraMovement-routed or
// default model" (see resolvePairModel in scene-video.ts), not silently pin
// this shot to whatever model happens to load first.
const SCENE_DEFAULT_VALUE = "__scene_default__";

function ShotVideoModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModelsForJobType("VIDEO_GENERATION").then((data) => {
      if (!cancelled) setModels(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items: Record<string, string> = { [SCENE_DEFAULT_VALUE]: "Scene default" };
  for (const model of models ?? []) items[model.id] = model.displayName;

  return (
    <Select
      value={value || SCENE_DEFAULT_VALUE}
      onValueChange={(v) => v && onChange(v === SCENE_DEFAULT_VALUE ? "" : v)}
      items={items}
    >
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SCENE_DEFAULT_VALUE}>Scene default</SelectItem>
        {(models ?? []).map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
