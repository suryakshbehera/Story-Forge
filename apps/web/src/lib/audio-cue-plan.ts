import { z } from "zod";
import { prisma } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { assembleSilentPicture, type SceneManifestEntry } from "@/lib/video-assembly";
import type { ScenesParentType } from "@/lib/scenes";

// Phase 11 — AUDIO_CUE_PLANNING. One whole-story/episode pass that watches
// the fully assembled, still-silent picture (assembleSilentPicture) and
// proposes narration/dialogue/musicPrompt/sfxPrompt per scene, grounded in
// what actually happens on screen rather than each scene's written
// description in isolation. Supersedes the old per-scene AUDIO_PLANNING
// step for music/sfx; also allowed to redraft narration/dialogue text
// itself (not just place it), unlike SCRIPT_DRAFTING/DIALOGUE_DIRECTION —
// see applyAudioCuePlan below for how that interacts with lines that
// already carry generated audio takes.

async function loadCuePlanStyleContext(parentType: ScenesParentType, parentId: string): Promise<string | null> {
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
  const parts = [
    bible?.genre && `Genre: ${bible.genre}`,
    bible?.tone && `Tone: ${bible.tone}`,
    bible?.visualStyle && `Visual style: ${bible.visualStyle}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function buildManifestText(manifest: SceneManifestEntry[]): string {
  return manifest
    .map((s) => {
      const roster = s.characterNames.length > 0 ? s.characterNames.join(", ") : "(no characters tagged on this scene)";
      const existing = [
        s.narration && `Current narration: ${s.narration}`,
        s.dialogueLines.length > 0 && `Current dialogue: ${s.dialogueLines.map((l) => `${l.character}: ${l.text}`).join(" / ")}`,
        s.musicPrompt && `Current music prompt: ${s.musicPrompt}`,
        s.sfxPrompt && `Current sfx prompt: ${s.sfxPrompt}`,
      ]
        .filter(Boolean)
        .join("\n");
      return `Scene ${s.sceneId} (#${s.order}${s.title ? ` "${s.title}"` : ""}, ${s.startSeconds.toFixed(1)}s–${(s.startSeconds + s.durationSeconds).toFixed(1)}s)\nCharacters available to speak: ${roster}\n${existing || "(nothing written yet)"}`;
    })
    .join("\n\n");
}

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const CUE_PLAN_SYSTEM_PROMPT = `You are the Audio Cue Plan step of Narrata's post-assembly audio pipeline. You're given the fully assembled, currently-silent picture for an entire story/episode as a video, plus a per-scene manifest of that video's exact timing, which characters are available to speak in each scene, and whatever narration/dialogue/music/sfx prompts already exist.

Watch the video and propose, for every scene, the narrator's voiceover script, spoken dialogue lines, a background music prompt, and a sound-effect prompt — grounded in what actually happens on screen in that scene's time range, not just its written description. You may keep existing text as-is, refine it, or replace it if it doesn't fit what the picture shows. Respect each scene's known duration: don't write narration/dialogue so long it can't plausibly be spoken within that scene's time range. Only write dialogue for characters in that scene's listed roster — never invent a speaker or use a character not listed for that scene.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "scenes": [
    {
      "sceneId": "must exactly match a scene id from the manifest",
      "narration": "the narrator's voiceover script for this scene, or an empty string if none",
      "dialogueLines": [{ "characterName": "must match a name from that scene's roster", "text": "the line" }],
      "musicPrompt": "a concrete background music prompt, or an empty string if this scene doesn't need music",
      "sfxPrompt": "a concrete sound-effect prompt, or an empty string if this scene doesn't need sfx"
    }
  ]
}
Include every scene id from the manifest, in any order. Leave a field empty rather than inventing content a scene doesn't call for.`;

const cuePlanResponseSchema = z.object({
  scenes: z.array(
    z.object({
      sceneId: z.string(),
      narration: z.string(),
      dialogueLines: z.array(z.object({ characterName: z.string(), text: z.string() })),
      musicPrompt: z.string(),
      sfxPrompt: z.string(),
    })
  ),
});

export interface AudioCuePlanEntry {
  sceneId: string;
  order: number;
  title: string | null;
  startSeconds: number;
  durationSeconds: number;
  narration: string;
  dialogueLines: { characterName: string; text: string }[];
  // >0 means this scene already has dialogue lines — applyAudioCuePlan
  // leaves them untouched (same additive-only-when-empty rule
  // generateSceneScript uses, so already-generated dialogue audio never
  // gets silently orphaned), so the UI can show that the proposal above
  // won't take effect for dialogue on apply.
  existingDialogueCount: number;
  musicPrompt: string;
  sfxPrompt: string;
}

export async function draftAudioCuePlan({
  parentType,
  parentId,
  modelId,
}: {
  parentType: ScenesParentType;
  parentId: string;
  modelId: string;
}): Promise<AudioCuePlanEntry[]> {
  const [{ base64, mimeType, manifest }, style] = await Promise.all([
    assembleSilentPicture(parentType, parentId),
    loadCuePlanStyleContext(parentType, parentId),
  ]);

  const userPrompt = [style && `# Style\n${style}`, `# Scene manifest\n${buildManifestText(manifest)}`].filter(Boolean).join("\n\n");

  // A large video attachment (a whole assembled episode) occasionally comes
  // back with an empty choices[0].message.content on the first attempt —
  // observed live: an identical retry of the same request succeeded, which
  // points at transient upstream flakiness on a heavy request rather than a
  // deterministic problem with the request itself. One retry only — if it's
  // failing for a real reason (e.g. the video is genuinely too large/long),
  // retrying forever would just burn time and cost without ever succeeding.
  let raw: string;
  try {
    raw = await callChatModel({
      modelId,
      systemPrompt: CUE_PLAN_SYSTEM_PROMPT,
      userPrompt,
      jsonMode: true,
      videos: [`data:${mimeType};base64,${base64}`],
    });
  } catch (error) {
    if (!(error instanceof OpenRouterError) || !error.message.includes("empty response")) throw error;
    raw = await callChatModel({
      modelId,
      systemPrompt: CUE_PLAN_SYSTEM_PROMPT,
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
  const parsed = cuePlanResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const byScene = new Map(manifest.map((s) => [s.sceneId, s]));
  return parsed.data.scenes
    .filter((s) => byScene.has(s.sceneId))
    .map((s) => {
      const scene = byScene.get(s.sceneId)!;
      return {
        sceneId: s.sceneId,
        order: scene.order,
        title: scene.title,
        startSeconds: scene.startSeconds,
        durationSeconds: scene.durationSeconds,
        narration: s.narration.trim(),
        dialogueLines: s.dialogueLines.map((l) => ({ characterName: l.characterName.trim(), text: l.text.trim() })).filter((l) => l.text.length > 0),
        existingDialogueCount: scene.dialogueLines.length,
        musicPrompt: s.musicPrompt.trim(),
        sfxPrompt: s.sfxPrompt.trim(),
      };
    })
    .sort((a, b) => a.order - b.order);
}

export interface ApplyAudioCuePlanEntry {
  sceneId: string;
  narration: string;
  dialogueLines: { characterName: string; text: string }[];
  musicPrompt: string;
  sfxPrompt: string;
}

// narration/musicPrompt/sfxPrompt are always overwritten with the (possibly
// user-edited) draft — same "AI proposes fresh, user can overwrite" idiom
// generateSceneScript/generateAudioPlan already used. dialogueLines are
// additive-only-when-the-scene-currently-has-none, same reasoning
// generateSceneScript documents: existing lines can carry generated audio
// takes that a silent overwrite would orphan.
export async function applyAudioCuePlan(parentType: ScenesParentType, parentId: string, entries: ApplyAudioCuePlanEntry[]): Promise<void> {
  for (const entry of entries) {
    const scene = await prisma.scene.findUniqueOrThrow({
      where: { id: entry.sceneId },
      include: { characters: { select: { id: true, name: true } }, dialogueLines: { select: { id: true } } },
    });
    const belongsToParent = parentType === "story" ? scene.storyId === parentId : scene.episodeId === parentId;
    if (!belongsToParent) {
      throw new Error(`Scene ${entry.sceneId} does not belong to this ${parentType}.`);
    }

    await prisma.scene.update({
      where: { id: entry.sceneId },
      data: {
        narration: entry.narration || null,
        musicPrompt: entry.musicPrompt || null,
        sfxPrompt: entry.sfxPrompt || null,
      },
    });

    if (scene.dialogueLines.length === 0 && entry.dialogueLines.length > 0) {
      const byName = new Map(scene.characters.map((c) => [c.name.trim().toLowerCase(), c.id]));
      const matched = entry.dialogueLines
        .map((line) => ({ characterId: byName.get(line.characterName.trim().toLowerCase()), text: line.text }))
        .filter((line): line is { characterId: string; text: string } => !!line.characterId && line.text.length > 0);

      await prisma.$transaction(
        matched.map((line, i) =>
          prisma.dialogueLine.create({ data: { sceneId: entry.sceneId, characterId: line.characterId, text: line.text, order: i + 1 } })
        )
      );
    }
  }
}
