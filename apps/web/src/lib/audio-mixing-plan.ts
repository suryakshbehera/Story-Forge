import { z } from "zod";
import { prisma } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { getSelectedFinalMix, type SceneManifestEntry, type SceneMixState } from "@/lib/video-assembly";
import type { ScenesParentType } from "@/lib/scenes";
import { parseClosingState, describeClosingState } from "@/lib/scene-continuity";

// AUDIO_MIXING_PLANNING — the "Sound Engineer" step. One whole-story/episode
// pass, structurally the twin of lib/audio-cue-plan.ts (draft/apply split,
// one video-input call, strict JSON, per-scene proposals into existing Scene
// fields) with one deliberate difference that changes everything about what
// it can do: it watches the selected FINAL, already-audio-mixed render
// (getSelectedFinalMix in lib/video-assembly.ts), not the silent picture.
//
// That's the whole point. Every problem this step exists to catch — dialogue
// buried under a music bed, a cue that slams in at full level on a cut, one
// scene twice as loud as the one before it — is inaudible in a silent
// picture and obvious in a mix. Audio Cue Plan decides *what* each scene
// should contain; this decides *how it should sit together*, after hearing
// the attempt, exactly as a sound engineer reviews a rough mix rather than a
// script.
//
// Nothing here regenerates audio. Every proposal lands in a Scene column the
// final ffmpeg render already knows how to apply (musicVolume/sfxVolume/
// duckMusicUnderDialogue/musicFadeInSeconds/musicFadeOutSeconds), so the
// user's next Final Assembly is the only cost of acting on a plan — no music
// or voice take is re-generated, re-paid for, or invalidated.

// Ceiling for a proposed fade, before the per-scene duration clamp below.
// A fade longer than this stops being a fade and becomes the cue's whole
// shape; if a scene really wants that, the per-scene clamp allows it up to
// the scene's own length, but an unbounded number from the model doesn't get
// to sneak through as one.
const MAX_FADE_SECONDS = 30;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // json_object mode guarantees syntactically valid JSON, not that a number
  // comes back typed as one — "0.2" is a routine response. Coerced rather
  // than rejected, same defensive posture as everywhere else in this codebase
  // that crosses the AI-response boundary.
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBooleanish(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

// Volumes are the one field where an unparseable answer must NOT fall back to
// zero: a scene silently losing its music because the model wrote "quiet"
// instead of 0.2 is a worse failure than ignoring the proposal. Unparseable
// keeps whatever the scene already has.
export function clampVolume(value: unknown, fallback: number): number {
  const parsed = toNumber(value);
  if (parsed == null) return fallback;
  return Math.min(Math.max(parsed, 0), 1);
}

// null and 0 both mean "no fade" — normalized to null so the DB has one
// representation of it rather than two. `maxSeconds` is the scene's own
// rendered length: a 4-second scene cannot have a 6-second fade, and ffmpeg
// would accept the attempt and render something arbitrary rather than fail.
export function clampFadeSeconds(value: unknown, maxSeconds: number | null): number | null {
  const parsed = toNumber(value);
  if (parsed == null || parsed <= 0) return null;
  const ceiling = maxSeconds != null && maxSeconds > 0 ? Math.min(MAX_FADE_SECONDS, maxSeconds) : MAX_FADE_SECONDS;
  return Math.min(parsed, ceiling);
}

async function loadMixStyleContext(parentType: ScenesParentType, parentId: string): Promise<string | null> {
  if (parentType === "story") {
    const story = await prisma.story.findUniqueOrThrow({ where: { id: parentId } });
    const parts = [story.genre && `Genre: ${story.genre}`, story.tone && `Tone: ${story.tone}`].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: parentId },
    include: { season: { include: { project: { include: { storyBible: true } } } } },
  });
  const bible = episode.season.project.storyBible;
  const parts = [bible?.genre && `Genre: ${bible.genre}`, bible?.tone && `Tone: ${bible.tone}`].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

// Defaults matching the Scene column defaults, for the (shouldn't-happen)
// case of a final-render manifest without a recorded mix — see
// SceneManifestEntry.mix. Better than refusing to draft: the model can still
// hear the render, it just can't be told what produced it.
const UNKNOWN_MIX: SceneMixState = {
  musicVolume: 0.25,
  sfxVolume: 0.8,
  duckMusicUnderDialogue: false,
  musicFadeInSeconds: null,
  musicFadeOutSeconds: null,
  hasVoice: false,
  hasMusic: false,
  hasSfx: false,
};

function describeMix(mix: SceneMixState): string {
  const layers = [mix.hasVoice && "voice (narration/dialogue)", mix.hasMusic && "music bed", mix.hasSfx && "sfx"]
    .filter(Boolean)
    .join(" + ");
  const fades = [
    mix.musicFadeInSeconds != null && mix.musicFadeInSeconds > 0 && `${mix.musicFadeInSeconds}s fade-in`,
    mix.musicFadeOutSeconds != null && mix.musicFadeOutSeconds > 0 && `${mix.musicFadeOutSeconds}s fade-out`,
  ].filter(Boolean);
  return [
    `Layers present in this scene: ${layers || "(silent — no voice, music or sfx)"}`,
    `Mix used for the render you're listening to: musicVolume ${mix.musicVolume}, sfxVolume ${mix.sfxVolume}, ducking ${
      mix.duckMusicUnderDialogue ? "ON" : "OFF"
    }, music fades ${fades.length > 0 ? fades.join(" and ") : "none"}`,
  ].join("\n");
}

function buildManifestText(manifest: SceneManifestEntry[]): string {
  return manifest
    .map((s) => {
      const mix = s.mix ?? UNKNOWN_MIX;
      // Same closing-state grounding as audio-cue-plan.ts's manifest: fade
      // and duck decisions are continuity decisions ("does the score carry
      // across this cut or stop at it"), so they get the same resolved
      // environment/story-state facts the visual pipeline already produced,
      // rather than being inferred from the audio alone.
      const closingStateLines = describeClosingState(parseClosingState(s.closingState));
      const content = [
        s.narration && `Narration: ${s.narration}`,
        s.dialogueLines.length > 0 && `Dialogue: ${s.dialogueLines.map((l) => `${l.character}: ${l.text}`).join(" / ")}`,
        s.musicPrompt && `Music is: ${s.musicPrompt}`,
        s.sfxPrompt && `SFX is: ${s.sfxPrompt}`,
        closingStateLines.length > 0 && `State as of the end of this scene: ${closingStateLines.join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
      return `Scene ${s.sceneId} (#${s.order}${s.title ? ` "${s.title}"` : ""}, ${s.startSeconds.toFixed(1)}s–${(
        s.startSeconds + s.durationSeconds
      ).toFixed(1)}s)\n${describeMix(mix)}\n${content || "(no script or audio prompts written)"}`;
    })
    .join("\n\n");
}

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const MIX_PLAN_SYSTEM_PROMPT = `You are the Sound Engineer step of Narrata's post-production audio pipeline. You're given the FINISHED, fully mixed video for an entire story/episode — picture and final soundtrack together — plus a per-scene manifest giving that render's exact timing and the mix settings each scene was rendered with.

Listen to the mix, scene by scene, and critique it the way a sound engineer reviews a rough mix. You are not writing or re-recording anything: narration, dialogue, music and sfx already exist as audio. Your only job is to propose better mix settings for each scene, which will be re-rendered with the same audio.

Judge, for each scene in its own time range:
- Is speech intelligible? If narration or dialogue is fighting the music bed, lower musicVolume and/or turn ducking on.
- Is the music bed doing anything at all, or is it so low it's wasted? A scene with no speech can usually carry a louder bed than one with wall-to-wall dialogue.
- Are the sound effects present and proportionate — audible without stepping on speech, not comically loud?
- Does the level jump between this scene and the one before it? Neighbouring scenes should feel like one continuous mix, not a playlist. If one scene is obviously louder or quieter than its neighbours without a story reason, bring it into line.
- Does the music enter or leave abruptly at this scene's boundaries? Propose a fade where a hard start/stop is jarring, and no fade where the cut should be hard (a sudden silence for impact, or a scene whose score simply continues from the previous one).

On ducking (duckMusicUnderDialogue): true makes the music dip automatically whenever someone is speaking and recover in the gaps, instead of sitting at one permanently low level. Prefer it for any scene with real narration or dialogue over a music bed — it lets the bed be louder in the gaps AND clearer under the voice. It does nothing in a scene with no voice layer at all; leave it false there.

On fades (musicFadeInSeconds / musicFadeOutSeconds): these apply to the music bed at this scene's own boundaries, in seconds. Use null (or 0) for no fade. Typical musical fades are 0.5-3 seconds; a long slow bloom can be longer. Never propose a fade longer than the scene's own duration shown in the manifest.

Use the manifest's per-scene state (environment, unfinished actions, continuity anchors, story state) where it's given: when two adjacent scenes are continuous — same location, same unbroken moment — the score should carry across the cut rather than fading out and back in. When the story cuts somewhere genuinely new, a fade is what sells it.

Leave a scene's numbers exactly as they are when the mix already works. Not every scene needs changing, and pointless churn costs a re-render.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "scenes": [
    {
      "sceneId": "must exactly match a scene id from the manifest",
      "musicVolume": 0.25,
      "sfxVolume": 0.8,
      "duckMusicUnderDialogue": false,
      "musicFadeInSeconds": null,
      "musicFadeOutSeconds": null,
      "reason": "one short sentence on what you heard and why you changed it, or why you left it alone"
    }
  ]
}
musicVolume and sfxVolume are numbers between 0 and 1. duckMusicUnderDialogue is a boolean. The two fade fields are a number of seconds or null. Include every scene id from the manifest, in any order.`;

// Every numeric/boolean field is accepted loosely here and normalized in the
// mapping below (see toNumber/toBooleanish) — a schema strict enough to
// reject "0.2" would throw away an otherwise perfectly good plan for the
// whole episode over one string-typed number.
const mixPlanResponseSchema = z.object({
  scenes: z.array(
    z.object({
      sceneId: z.string(),
      musicVolume: z.unknown(),
      sfxVolume: z.unknown(),
      duckMusicUnderDialogue: z.unknown(),
      musicFadeInSeconds: z.unknown(),
      musicFadeOutSeconds: z.unknown(),
      reason: z.unknown(),
    })
  ),
});

export interface AudioMixingPlanEntry {
  sceneId: string;
  order: number;
  title: string | null;
  startSeconds: number;
  durationSeconds: number;

  // What the render being critiqued actually used, so the panel can show
  // before → after instead of a bare set of numbers with no baseline.
  current: SceneMixState;

  // The proposal.
  musicVolume: number;
  sfxVolume: number;
  duckMusicUnderDialogue: boolean;
  musicFadeInSeconds: number | null;
  musicFadeOutSeconds: number | null;
  reason: string;
}

export async function draftAudioMixingPlan({
  parentType,
  parentId,
  modelId,
}: {
  parentType: ScenesParentType;
  parentId: string;
  modelId: string;
}): Promise<AudioMixingPlanEntry[]> {
  const [finalMix, style] = await Promise.all([
    getSelectedFinalMix(parentType, parentId),
    loadMixStyleContext(parentType, parentId),
  ]);
  // Plain Errors, not OpenRouterError — these are missing-prerequisite
  // conditions (400), not AI-upstream failures (502), same split
  // draftAudioCuePlan uses.
  if (!finalMix) {
    throw new Error("Assemble and select a final video (Final Assembly) before drafting a mix plan.");
  }
  const { base64, mimeType, manifest } = finalMix;
  if (manifest.length === 0) {
    throw new Error(
      "This final video was rendered before mix planning existed, so it has no per-scene timeline recorded. Re-run Final Assembly, select the new render, then draft again."
    );
  }

  const userPrompt = [style && `# Style\n${style}`, `# Scene manifest\n${buildManifestText(manifest)}`]
    .filter(Boolean)
    .join("\n\n");

  // Same one-retry-on-empty-response allowance as draftAudioCuePlan, for the
  // same observed reason: a heavy video attachment occasionally comes back
  // with empty content on the first attempt and succeeds on an identical
  // retry. One retry only — a genuinely too-large request would just burn
  // time and cost forever.
  let raw: string;
  try {
    raw = await callChatModel({
      modelId,
      systemPrompt: MIX_PLAN_SYSTEM_PROMPT,
      userPrompt,
      jsonMode: true,
      videos: [`data:${mimeType};base64,${base64}`],
    });
  } catch (error) {
    if (!(error instanceof OpenRouterError) || !error.message.includes("empty response")) throw error;
    raw = await callChatModel({
      modelId,
      systemPrompt: MIX_PLAN_SYSTEM_PROMPT,
      userPrompt,
      jsonMode: true,
      videos: [`data:${mimeType};base64,${base64}`],
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = mixPlanResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const byScene = new Map(manifest.map((s) => [s.sceneId, s]));
  return parsed.data.scenes
    .filter((s) => byScene.has(s.sceneId))
    .map((s) => {
      const scene = byScene.get(s.sceneId)!;
      const current = scene.mix ?? UNKNOWN_MIX;
      return {
        sceneId: s.sceneId,
        order: scene.order,
        title: scene.title,
        startSeconds: scene.startSeconds,
        durationSeconds: scene.durationSeconds,
        current,
        musicVolume: clampVolume(s.musicVolume, current.musicVolume),
        sfxVolume: clampVolume(s.sfxVolume, current.sfxVolume),
        duckMusicUnderDialogue: toBooleanish(s.duckMusicUnderDialogue),
        musicFadeInSeconds: clampFadeSeconds(s.musicFadeInSeconds, scene.durationSeconds),
        musicFadeOutSeconds: clampFadeSeconds(s.musicFadeOutSeconds, scene.durationSeconds),
        reason: typeof s.reason === "string" ? s.reason.trim() : "",
      };
    })
    .sort((a, b) => a.order - b.order);
}

export interface ApplyAudioMixingPlanEntry {
  sceneId: string;
  musicVolume: number;
  sfxVolume: number;
  duckMusicUnderDialogue: boolean;
  musicFadeInSeconds: number | null;
  musicFadeOutSeconds: number | null;
}

// All five fields always overwrite — same "AI proposes fresh, user reviews
// and can overwrite in the panel first" idiom applyAudioCuePlan uses for
// narration/musicPrompt/sfxPrompt. There's no additive-only case to worry
// about here, unlike that step's dialogue lines: these are scalar render
// settings, not rows that other generated assets hang off, so re-applying a
// plan can't orphan anything. The render they affect simply happens next
// time the user re-runs Final Assembly.
//
// Re-clamped rather than trusted even though draftAudioMixingPlan already
// clamped: the values pass through an editable UI and an HTTP body on the
// way here, so this is the last line before they reach ffmpeg.
export async function applyAudioMixingPlan(
  parentType: ScenesParentType,
  parentId: string,
  entries: ApplyAudioMixingPlanEntry[]
): Promise<void> {
  for (const entry of entries) {
    const scene = await prisma.scene.findUniqueOrThrow({
      where: { id: entry.sceneId },
      select: { id: true, storyId: true, episodeId: true, musicVolume: true, sfxVolume: true },
    });
    const belongsToParent = parentType === "story" ? scene.storyId === parentId : scene.episodeId === parentId;
    if (!belongsToParent) {
      throw new Error(`Scene ${entry.sceneId} does not belong to this ${parentType}.`);
    }

    await prisma.scene.update({
      where: { id: entry.sceneId },
      data: {
        musicVolume: clampVolume(entry.musicVolume, scene.musicVolume),
        sfxVolume: clampVolume(entry.sfxVolume, scene.sfxVolume),
        duckMusicUnderDialogue: entry.duckMusicUnderDialogue,
        // No scene-duration ceiling available here (the render that knew it
        // may be several edits old by now) — the absolute cap still applies,
        // and musicFadeFilters in video-assembly.ts clamps again against the
        // scene's real length at render time.
        musicFadeInSeconds: clampFadeSeconds(entry.musicFadeInSeconds, null),
        musicFadeOutSeconds: clampFadeSeconds(entry.musicFadeOutSeconds, null),
      },
    });
  }
}
