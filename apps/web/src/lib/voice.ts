import { z } from "zod";
import { prisma, type Asset } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { generateSpeech, ElevenLabsError } from "@/lib/ai/elevenlabs";
import { storage, buildStorageKey } from "@/lib/storage";

export interface SerializedAudioTake {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
}

export function serializeAudioTake(asset: Asset): SerializedAudioTake {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
  };
}

// A Scene's project is reached via Story or Episode→Season — resolving it
// here (rather than accepting a voice string from the client) is what makes
// narratorVoiceName actually authoritative: the caller can't override it.
async function resolveSceneProjectId(sceneId: string): Promise<string> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { story: true, episode: { include: { season: true } } },
  });
  const projectId = scene.story?.projectId ?? scene.episode?.season.projectId;
  if (!projectId) throw new Error(`Scene ${sceneId} has neither a story nor an episode parent.`);
  return projectId;
}

// ── Narration — one voiceover script per Scene (Scene.narration, manually
// written, mirroring Episode.summary), with generated audio takes attached
// via Asset.narrationSceneId. Voice is always the project's narratorVoiceName
// — never a per-call override — so the narrator sounds the same in every
// scene of a story; see Project.narratorVoiceName in schema.prisma. ──────

export async function generateNarrationAudio({
  sceneId,
  modelId,
}: {
  sceneId: string;
  modelId: string;
}): Promise<SerializedAudioTake> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  if (!scene.narration?.trim()) {
    throw new ElevenLabsError("Write a narration script for this scene before generating audio.");
  }

  const projectId = await resolveSceneProjectId(sceneId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.narratorVoiceName?.trim()) {
    throw new ElevenLabsError(
      "Set a Narrator Voice in the Voice Settings panel above before generating narration audio."
    );
  }

  const generated = await generateSpeech({ modelId, text: scene.narration, voiceId: project.narratorVoiceName });
  const buffer = Buffer.from(generated.base64, "base64");
  const key = buildStorageKey("scenes", sceneId, "narration.mp3");
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_NARRATION",
        storageKey: key,
        fileName: "narration.mp3",
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        narrationSceneId: sceneId,
        isSelected: true,
        prompt: scene.narration,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioTake(asset);
}

export async function getSceneNarrationAudio(sceneId: string): Promise<SerializedAudioTake[]> {
  const assets = await prisma.asset.findMany({
    where: { narrationSceneId: sceneId },
    orderBy: { createdAt: "desc" },
  });
  return assets.map(serializeAudioTake);
}

export async function selectNarrationAudio(sceneId: string, assetId: string): Promise<SerializedAudioTake> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.narrationSceneId !== sceneId) {
      throw new Error("Audio take does not belong to this scene's narration.");
    }
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioTake(updated);
  });
}

export async function deleteNarrationAudio(sceneId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.narrationSceneId !== sceneId) {
    throw new Error("Audio take does not belong to this scene's narration.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// ── Dialogue lines — ordered, per-Character spoken lines within a Scene,
// each with its own audio takes via Asset.dialogueLineId. ────────────────

const DIALOGUE_LINE_INCLUDE = {
  character: { select: { id: true, name: true, voiceName: true } },
  audio: { orderBy: { createdAt: "desc" as const } },
};

interface DialogueLineRow {
  id: string;
  sceneId: string;
  order: number;
  text: string;
  deliveryNotes: string | null;
  speed: number | null;
  character: { id: string; name: string; voiceName: string | null };
  audio: Asset[];
}

export interface SerializedDialogueLine {
  id: string;
  sceneId: string;
  order: number;
  text: string;
  deliveryNotes: string | null;
  speed: number | null;
  character: { id: string; name: string; voiceName: string | null };
  audio: SerializedAudioTake[];
}

export function serializeDialogueLine(line: DialogueLineRow): SerializedDialogueLine {
  return {
    id: line.id,
    sceneId: line.sceneId,
    order: line.order,
    text: line.text,
    deliveryNotes: line.deliveryNotes,
    speed: line.speed,
    character: line.character,
    audio: line.audio.map(serializeAudioTake),
  };
}

export async function getSceneDialogueLines(sceneId: string): Promise<SerializedDialogueLine[]> {
  const lines = await prisma.dialogueLine.findMany({
    where: { sceneId },
    orderBy: { order: "asc" },
    include: DIALOGUE_LINE_INCLUDE,
  });
  return lines.map(serializeDialogueLine);
}

export async function createDialogueLine({
  sceneId,
  characterId,
  text,
}: {
  sceneId: string;
  characterId: string;
  text: string;
}): Promise<SerializedDialogueLine> {
  const count = await prisma.dialogueLine.count({ where: { sceneId } });
  const line = await prisma.dialogueLine.create({
    data: { sceneId, characterId, text, order: count + 1 },
    include: DIALOGUE_LINE_INCLUDE,
  });
  return serializeDialogueLine(line);
}

export async function updateDialogueLine(
  id: string,
  fields: { characterId?: string; text?: string; deliveryNotes?: string | null; speed?: number | null }
): Promise<SerializedDialogueLine> {
  const line = await prisma.dialogueLine.update({
    where: { id },
    data: fields,
    include: DIALOGUE_LINE_INCLUDE,
  });
  return serializeDialogueLine(line);
}

// Phase 8 — DIALOGUE_DIRECTION: directs every line in a scene in one call
// (not line by line) so a conversation's emotional arc stays coherent across
// lines, same batch-per-scene idea as Phase 7's Audio Plan. AI-drafted, then
// user-editable via updateDialogueLine above — lines the AI omits from its
// response keep whatever direction they already had.

const dialogueDirectionResponseSchema = z.object({
  lines: z.array(
    z.object({
      order: z.number().int(),
      deliveryNotes: z.string(),
      speed: z.number().min(0.25).max(4).nullable().optional(),
    })
  ),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
const DIALOGUE_DIRECTION_SYSTEM_PROMPT = `You are the Dialogue Direction step of Narrata's Voice pipeline. Given a scene's ordered dialogue lines (with speaker names), direct how each line should be delivered — emotion, tone, emphasis, pacing — keeping the conversation's emotional arc coherent from line to line.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "lines": [
    { "order": 1, "deliveryNotes": "concrete delivery direction for a text-to-speech model, e.g. 'anxious, quiet, hesitant pauses between phrases'", "speed": 1.0 }
  ]
}
speed is a pace multiplier where 1.0 is normal, 0.25 is slowest, 4.0 is fastest — omit it to leave pace at the default.`;

export async function generateDialogueDirection({
  sceneId,
  modelId,
}: {
  sceneId: string;
  modelId: string;
}): Promise<SerializedDialogueLine[]> {
  const lines = await prisma.dialogueLine.findMany({
    where: { sceneId },
    orderBy: { order: "asc" },
    include: { character: { select: { name: true } } },
  });
  if (lines.length === 0) {
    throw new OpenRouterError("This scene has no dialogue lines yet.");
  }

  const userPrompt = lines.map((l) => `${l.order}. ${l.character.name}: ${l.text}`).join("\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: DIALOGUE_DIRECTION_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = dialogueDirectionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const byOrder = new Map(parsed.data.lines.map((l) => [l.order, l]));
  await prisma.$transaction(
    lines
      .filter((line) => byOrder.has(line.order))
      .map((line) => {
        const direction = byOrder.get(line.order)!;
        return prisma.dialogueLine.update({
          where: { id: line.id },
          data: { deliveryNotes: direction.deliveryNotes, speed: direction.speed ?? null },
        });
      })
  );

  return getSceneDialogueLines(sceneId);
}

// ── Script Drafting — one AI call per scene that proposes Scene.narration
// plus, only when the scene has no dialogue lines yet, new DialogueLine rows
// for characters already attached to the scene (Scene.characters — not the
// full project roster, so the AI can't invent a speaker who isn't part of
// this scene). Narration always gets overwritten by a fresh draft, same "AI
// proposes, user can overwrite" idiom used throughout this pipeline; dialogue
// is additive-only-when-empty because lines can carry generated audio takes
// that a silent overwrite would orphan (same rule applyAudioCuePlan in
// lib/audio-cue-plan.ts follows for the same reason). ───────────────────────

// Scoped-down copy of scene-audio.ts's loadAudioStyleContext, not imported —
// same reasoning given there: this step doesn't need that file's other
// concerns, just genre/tone for tone-matching the script.
async function loadSceneScriptContext(sceneId: string) {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      story: true,
      episode: { include: { season: { include: { project: { include: { storyBible: true } } } } } },
      characters: { select: { id: true, name: true, personality: true } },
      dialogueLines: { select: { id: true } },
    },
  });

  const genre = scene.story?.genre ?? scene.episode?.season.project.storyBible?.genre ?? null;
  const tone = scene.story?.tone ?? scene.episode?.season.project.storyBible?.tone ?? null;
  const style = [genre && `Genre: ${genre}`, tone && `Tone: ${tone}`].filter(Boolean).join("\n") || null;

  return { scene, style };
}

const scriptDraftResponseSchema = z.object({
  narration: z.string(),
  dialogueLines: z.array(
    z.object({
      characterName: z.string(),
      text: z.string(),
    })
  ),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
function buildScriptDraftSystemPrompt(characterNames: string[]): string {
  const roster = characterNames.length > 0 ? characterNames.join(", ") : "(no characters are attached to this scene)";
  return `You are the Script Drafting step of Narrata's Voice pipeline. Given one scene's description and style context, draft the narrator's voiceover script and, if the scene calls for spoken dialogue, the dialogue lines for it.

Characters available to speak in this scene: ${roster}
Only write dialogue for characters in that exact list — never invent a new speaker or use a character not listed. If the scene needs a line from someone not on the list, leave that line out rather than misattributing it.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "narration": "the narrator's voiceover script for this scene, or an empty string if the scene should play out through dialogue alone / needs no narration",
  "dialogueLines": [
    { "characterName": "must exactly match a name from the roster above", "text": "the line they say" }
  ]
}
Leave "dialogueLines" empty if this scene doesn't call for spoken dialogue — not every scene needs it.`;
}

export interface SceneScriptDraft {
  narration: string | null;
  dialogueLines: SerializedDialogueLine[];
  dialogueSkipped: boolean;
}

export async function generateSceneScript({
  sceneId,
  modelId,
}: {
  sceneId: string;
  modelId: string;
}): Promise<SceneScriptDraft> {
  const { scene, style } = await loadSceneScriptContext(sceneId);

  const userPrompt = [`# Scene\n${scene.description}`, style && `# Style\n${style}`].filter(Boolean).join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: buildScriptDraftSystemPrompt(scene.characters.map((c) => c.name)),
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = scriptDraftResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const narration = parsed.data.narration.trim() || null;
  await prisma.scene.update({ where: { id: sceneId }, data: { narration } });

  const dialogueSkipped = scene.dialogueLines.length > 0;
  if (!dialogueSkipped && parsed.data.dialogueLines.length > 0) {
    const byName = new Map(scene.characters.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const matched = parsed.data.dialogueLines
      .map((line) => ({ characterId: byName.get(line.characterName.trim().toLowerCase()), text: line.text.trim() }))
      .filter((line): line is { characterId: string; text: string } => !!line.characterId && line.text.length > 0);

    await prisma.$transaction(
      matched.map((line, i) =>
        prisma.dialogueLine.create({ data: { sceneId, characterId: line.characterId, text: line.text, order: i + 1 } })
      )
    );
  }

  return { narration, dialogueLines: await getSceneDialogueLines(sceneId), dialogueSkipped };
}

export async function deleteDialogueLine(id: string): Promise<void> {
  const assets = await prisma.asset.findMany({ where: { dialogueLineId: id } });

  await prisma.$transaction(async (tx) => {
    const line = await tx.dialogueLine.findUniqueOrThrow({ where: { id } });
    // Asset.dialogueLineId cascades in the DB — the rows above are gone once
    // this delete completes. Filesystem cleanup happens after the tx below.
    await tx.dialogueLine.delete({ where: { id } });

    const remaining = await tx.dialogueLine.findMany({
      where: { sceneId: line.sceneId },
      orderBy: { order: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      const expectedOrder = i + 1;
      if (remaining[i].order !== expectedOrder) {
        await tx.dialogueLine.update({ where: { id: remaining[i].id }, data: { order: expectedOrder } });
      }
    }
  });

  for (const asset of assets) {
    await storage.remove(asset.storageKey);
  }
}

export async function moveDialogueLine(id: string, direction: "up" | "down"): Promise<SerializedDialogueLine[]> {
  return prisma.$transaction(async (tx) => {
    const line = await tx.dialogueLine.findUniqueOrThrow({ where: { id } });
    const neighborOrder = direction === "up" ? line.order - 1 : line.order + 1;
    const neighbor = await tx.dialogueLine.findFirst({ where: { sceneId: line.sceneId, order: neighborOrder } });

    if (!neighbor) {
      const current = await tx.dialogueLine.findUniqueOrThrow({ where: { id }, include: DIALOGUE_LINE_INCLUDE });
      return [serializeDialogueLine(current)];
    }

    // Per-statement unique constraint isn't deferred — swap through a
    // sentinel order to avoid a transient collision on (sceneId, order).
    await tx.dialogueLine.update({ where: { id: line.id }, data: { order: -1 } });
    await tx.dialogueLine.update({ where: { id: neighbor.id }, data: { order: line.order } });
    const updatedLine = await tx.dialogueLine.update({
      where: { id: line.id },
      data: { order: neighbor.order },
      include: DIALOGUE_LINE_INCLUDE,
    });
    const updatedNeighbor = await tx.dialogueLine.findUniqueOrThrow({
      where: { id: neighbor.id },
      include: DIALOGUE_LINE_INCLUDE,
    });

    return [serializeDialogueLine(updatedLine), serializeDialogueLine(updatedNeighbor)];
  });
}

export async function generateDialogueAudio({
  dialogueLineId,
  modelId,
}: {
  dialogueLineId: string;
  modelId: string;
}): Promise<SerializedAudioTake> {
  const line = await prisma.dialogueLine.findUniqueOrThrow({
    where: { id: dialogueLineId },
    include: { character: true },
  });

  // Always the character's assigned voice — never a per-call override — so
  // one character sounds the same in every scene of a story. No fallback
  // default: an unset voice blocks generation rather than silently reusing
  // a generic voice that two different unassigned characters would share.
  if (!line.character.voiceName?.trim()) {
    throw new ElevenLabsError(
      `Set a voice for ${line.character.name} in their Character profile before generating dialogue audio.`
    );
  }

  const generated = await generateSpeech({
    modelId,
    text: line.text,
    voiceId: line.character.voiceName,
    instructions: line.deliveryNotes ?? undefined,
    speed: line.speed ?? undefined,
  });
  const buffer = Buffer.from(generated.base64, "base64");
  const key = buildStorageKey("dialogue-lines", dialogueLineId, "line.mp3");
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { dialogueLineId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_DIALOGUE",
        storageKey: key,
        fileName: "line.mp3",
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        dialogueLineId,
        isSelected: true,
        prompt: line.text,
        modelId,
        createdBy: "AI",
      },
    });
  });

  return serializeAudioTake(asset);
}

export async function selectDialogueAudio(dialogueLineId: string, assetId: string): Promise<SerializedAudioTake> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.dialogueLineId !== dialogueLineId) {
      throw new Error("Audio take does not belong to this dialogue line.");
    }
    await tx.asset.updateMany({ where: { dialogueLineId, isSelected: true }, data: { isSelected: false } });
    const updated = await tx.asset.update({ where: { id: assetId }, data: { isSelected: true } });
    return serializeAudioTake(updated);
  });
}

export async function deleteDialogueAudio(dialogueLineId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.dialogueLineId !== dialogueLineId) {
    throw new Error("Audio take does not belong to this dialogue line.");
  }
  await storage.remove(asset.storageKey);
  await prisma.asset.delete({ where: { id: assetId } });
}

// For the scene pages' initial SSR load — takes a scene queried with
// { narrationAudio: {...}, dialogueLines: { include: { character, audio } } }
// added to SCENE_INCLUDE and serializes those two relations the same way the
// API routes above do, so the client always gets the same shape regardless
// of whether the data arrived via initial page load or a fetch() call.
export function mapSceneVoiceData<
  T extends {
    narration: string | null;
    narrationAudio: Asset[];
    dialogueLines: DialogueLineRow[];
  },
>(scene: T) {
  return {
    ...scene,
    narrationAudio: scene.narrationAudio.map(serializeAudioTake),
    dialogueLines: scene.dialogueLines.map(serializeDialogueLine),
  };
}
