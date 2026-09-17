import { z } from "zod";
import { prisma, Prisma, type Asset } from "@/lib/db";
import { callChatModel, generateSpeech as generateOpenRouterSpeech, OpenRouterError } from "@/lib/ai/openrouter";
import { generateSpeechWithTimestamps as generateElevenLabsSpeech, ElevenLabsError, type WordTimestamp } from "@/lib/ai/elevenlabs";
import { generateSpeech as generateSarvamSpeech, SarvamError } from "@/lib/ai/sarvam";
import { sarvamLanguageCode, elevenLabsLanguageSupported, resolveSceneLanguage } from "@/lib/languages";
import { getSceneTranslation, getDialogueLineTranslation, resolveVoiceForLanguage } from "@/lib/localization";
import { storage, buildStorageKey } from "@/lib/storage";
import { STALE_MS } from "@/lib/generation-claims";
import { recordGenerationEvent, resolveSceneProjectId } from "@/lib/generation-events";
import { EMOTION_LABELS, EMOTION_INTENSITY_LABELS } from "@/lib/emotion";

export interface SerializedAudioTake {
  id: string;
  url: string;
  isSelected: boolean;
  createdAt: Date;
  // Word-level speech timing, only present for ElevenLabs-generated takes
  // (see Asset.wordTimestamps in schema.prisma) — null for Sarvam/OpenRouter
  // takes, neither of which exposes timestamps. Not consumed by any renderer
  // yet; exposed here so a future caption/per-shot-sync UI doesn't need a
  // schema or API change to reach it.
  wordTimestamps: WordTimestamp[] | null;
  // Dubbing — null for the project's own primary-language takes, an
  // INDIAN_LANGUAGES value for a dub take. See Asset.language in
  // schema.prisma.
  language: string | null;
}

// Audio takes are usually mp3 (ElevenLabs/Sarvam always, OpenRouter for most
// models) but OpenRouter falls back to wav for models that only support PCM
// output (see lib/ai/openrouter.ts's generateSpeech) — the stored filename's
// extension should match rather than always claiming .mp3, since the actual
// Content-Type served back (apps/web/src/app/api/storage/[...key]/route.ts)
// already comes from Asset.mimeType, not the filename.
function audioExtension(mimeType: string): string {
  return mimeType === "audio/wav" ? "wav" : "mp3";
}

export function serializeAudioTake(asset: Asset): SerializedAudioTake {
  return {
    id: asset.id,
    url: storage.url(asset.storageKey),
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
    wordTimestamps: (asset.wordTimestamps as WordTimestamp[] | null) ?? null,
    language: asset.language,
  };
}

// VOICE has three providers (see lib/ai/elevenlabs.ts, lib/ai/sarvam.ts,
// lib/ai/openrouter.ts's generateSpeech) — ElevenLabs for the languages it
// covers, Sarvam for Indic languages ElevenLabs' TTS doesn't (added
// 2026-08-18 specifically because Odia is one of them), OpenRouter for
// whatever OpenAI-compatible TTS model/voice the user points an AiModelOption
// row at (added 2026-08-19 on request — OpenRouter has its own documented
// POST /api/v1/audio/speech endpoint, unlike the abandoned music/SFX
// chat-completions workaround). `provider` comes from the selected
// AiModelOption row, never guessed — an unrecognized provider errors clearly
// rather than silently misrouting to ElevenLabs with a modelId it doesn't
// understand (exactly what happened before this dispatch existed: Phase 10
// hardcoded ElevenLabs for every VOICE call regardless of which row was
// actually selected).
async function generateSpeechForProvider({
  provider,
  modelId,
  text,
  voiceId,
  sceneId,
  instructions,
  speed,
  language: dubLanguage,
}: {
  provider: string;
  modelId: string;
  text: string;
  voiceId: string;
  sceneId: string;
  instructions?: string;
  speed?: number;
  // Dubbing — the dub's own target language, already known by the caller
  // (generateNarrationAudio/generateDialogueAudio resolved it from the
  // translation row, not from the Scene/Story). When set, this is used
  // as-is instead of resolveSceneLanguage's Story/StoryBible lookup below —
  // a dub call must validate against the language it's actually generating,
  // never silently fall back to the project's own primary language.
  language?: string;
}): Promise<{ base64: string; mimeType: string; costUsd?: number; wordTimestamps?: WordTimestamp[] }> {
  const resolveLanguage = () => (dubLanguage !== undefined ? Promise.resolve(dubLanguage) : resolveSceneLanguage(sceneId));

  if (provider === "sarvam") {
    const language = await resolveLanguage();
    const languageCode = sarvamLanguageCode(language);
    if (!languageCode) {
      throw new SarvamError(
        language
          ? `Sarvam doesn't support "${language}" — set a Sarvam-supported language on the Story/Series, or pick a different Voice provider.`
          : "Set a Language on this Story/Series (Story/Series settings) before generating Sarvam voice audio."
      );
    }
    return generateSarvamSpeech({ modelId, text, voiceId, languageCode, speed });
  }
  if (provider === "elevenlabs") {
    const language = await resolveLanguage();
    if (!elevenLabsLanguageSupported(modelId, language)) {
      throw new ElevenLabsError(
        `ElevenLabs' ${modelId} model doesn't support "${language}" — set a different Voice model in Settings → AI Models (e.g. a Sarvam model, if this language is one of its 11), or pick a language ${modelId} does support.`
      );
    }
    return generateElevenLabsSpeech({ modelId, text, voiceId, instructions, speed });
  }
  if (provider === "openrouter") {
    return generateOpenRouterSpeech({ modelId, text, voiceId, instructions, speed });
  }
  throw new Error(`Unsupported Voice provider "${provider}" — pick an ElevenLabs, Sarvam, or OpenRouter model in Settings → AI Models.`);
}

// ── Narration — one voiceover script per Scene (Scene.narration, manually
// written, mirroring Episode.summary), with generated audio takes attached
// via Asset.narrationSceneId. Voice is always the project's narratorVoiceName
// — never a per-call override — so the narrator sounds the same in every
// scene of a story; see Project.narratorVoiceName in schema.prisma. ──────

export async function generateNarrationAudio({
  sceneId,
  modelId,
  provider,
  language,
}: {
  sceneId: string;
  modelId: string;
  provider: string;
  // Dubbing — omitted/undefined generates the project's own primary
  // language exactly as before; set, generates that dub language instead,
  // reading text/voice from the translation/voicesByLanguage side rather
  // than Scene.narration/Project.narratorVoiceName. See lib/localization.ts.
  language?: string;
}): Promise<SerializedAudioTake> {
  const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
  const projectId = await resolveSceneProjectId(sceneId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  let text: string;
  let instructions: string | undefined;
  let speed: number | undefined;
  let voiceId: string;
  if (language) {
    const translation = await getSceneTranslation(sceneId, language);
    if (!translation?.narration?.trim()) {
      throw new ElevenLabsError(`Translate this scene's narration into ${language} before generating audio.`);
    }
    voiceId = resolveVoiceForLanguage(project.narratorVoicesByLanguage, language) ?? "";
    if (!voiceId) {
      throw new ElevenLabsError(`Set a Narrator Voice for ${language} in the Translations panel before generating narration audio.`);
    }
    text = translation.narration;
    instructions = translation.narrationDeliveryNotes ?? undefined;
    speed = translation.narrationSpeed ?? undefined;
  } else {
    if (!scene.narration?.trim()) {
      throw new ElevenLabsError("Write a narration script for this scene before generating audio.");
    }
    if (!project.narratorVoiceName?.trim()) {
      throw new ElevenLabsError(
        "Set a Narrator Voice in the Voice Settings panel above before generating narration audio."
      );
    }
    text = scene.narration;
    voiceId = project.narratorVoiceName;
    instructions = scene.narrationDeliveryNotes ?? undefined;
    speed = scene.narrationSpeed ?? undefined;
  }

  const startedAt = Date.now();
  let generated: { base64: string; mimeType: string; costUsd?: number; wordTimestamps?: WordTimestamp[] };
  try {
    generated = await generateSpeechForProvider({
      provider,
      modelId,
      text,
      voiceId,
      sceneId,
      instructions,
      speed,
      language,
    });
  } catch (error) {
    await recordGenerationEvent({
      jobType: "VOICE",
      provider,
      modelId,
      projectId,
      entityType: "SCENE",
      entityId: sceneId,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await recordGenerationEvent({
    jobType: "VOICE",
    provider,
    modelId,
    projectId,
    entityType: "SCENE",
    entityId: sceneId,
    costUsd: generated.costUsd,
    durationMs: Date.now() - startedAt,
    success: true,
  });
  const buffer = Buffer.from(generated.base64, "base64");
  const fileName = `narration${language ? `-${language}` : ""}.${audioExtension(generated.mimeType)}`;
  const key = buildStorageKey("scenes", sceneId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, language: language ?? null, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_NARRATION",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        narrationSceneId: sceneId,
        language: language ?? null,
        isSelected: true,
        prompt: text,
        modelId,
        createdBy: "AI",
        wordTimestamps: generated.wordTimestamps ? (generated.wordTimestamps as unknown as Prisma.InputJsonValue) : undefined,
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
    // Scoped to this asset's own language (null = primary) — a dub take's
    // take-history is independent of the primary language's, and of every
    // other dub language's. See Asset.language in schema.prisma.
    await tx.asset.updateMany({
      where: { narrationSceneId: sceneId, language: asset.language, isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { isSelected: true, reviewedAt: new Date() },
    });
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

// ── Director AI emotion → Voice direction ─────────────────────────────────
// There is no Shot<->DialogueLine/narration link (shots subdivide a scene
// visually, dialogue lines and narration are separate scene-level scripts),
// so this can't bind a specific line to a specific shot's emotion. Instead
// it hands Voice direction the scene's shots as an ordered emotional arc —
// informative context so the read doesn't contradict what the Director
// already resolved, the same "batch the whole scene in one call" idea the
// direction prompts already use for internal coherence.
type EmotionArcShot = { order: number; emotion: string | null; emotionIntensity: string | null };

function buildEmotionalArcBlock(shots: EmotionArcShot[]): string | null {
  const lines = shots
    .filter((s) => s.emotion)
    .map((s) => {
      const emotion = EMOTION_LABELS[s.emotion as keyof typeof EMOTION_LABELS];
      const intensity = s.emotionIntensity ? EMOTION_INTENSITY_LABELS[s.emotionIntensity as keyof typeof EMOTION_INTENSITY_LABELS] : null;
      return `Shot ${s.order}: ${intensity ? `${intensity}, ` : ""}${emotion}`;
    });
  if (lines.length === 0) return null;
  return `# Director's emotional arc for this scene (context, not a per-line binding — use it to keep the read consistent with the scene's visual direction)\n${lines.join("\n")}`;
}

const narrationDirectionResponseSchema = z.object({
  deliveryNotes: z.string(),
  speed: z.number().min(0.25).max(4).nullable().optional(),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement. Mirrors
// DIALOGUE_DIRECTION exactly, one level up: a single narration script
// instead of an ordered list of lines, otherwise the same shape/behavior.
const NARRATION_DIRECTION_SYSTEM_PROMPT = `You are the Narration Direction step of Narrata's Voice pipeline. Given a scene's narration script, direct how it should be delivered — emotion, tone, emphasis, pacing.

When a "# Director's emotional arc" section is present, it reflects decisions already made for this scene's shots — keep your delivery direction consistent with that arc rather than inventing a contradictory one, but use your own judgment for anything it doesn't cover.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "deliveryNotes": "concrete delivery direction for a text-to-speech model, e.g. 'measured, ominous, a long pause before the last sentence'",
  "speed": 1.0
}
speed is a pace multiplier where 1.0 is normal, 0.25 is slowest, 4.0 is fastest — omit it to leave pace at the default.`;

export interface NarrationDirection {
  narrationDeliveryNotes: string | null;
  narrationSpeed: number | null;
}

export async function generateNarrationDirection({
  sceneId,
  modelId,
}: {
  sceneId: string;
  modelId: string;
}): Promise<NarrationDirection> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { shots: { orderBy: { order: "asc" }, select: { order: true, emotion: true, emotionIntensity: true } } },
  });
  if (!scene.narration?.trim()) {
    throw new OpenRouterError("Write a narration script for this scene before directing it.");
  }

  const arcBlock = buildEmotionalArcBlock(scene.shots);
  const userPrompt = arcBlock ? `${arcBlock}\n\n# Narration script\n${scene.narration}` : scene.narration;

  const raw = await callChatModel({
    modelId,
    systemPrompt: NARRATION_DIRECTION_SYSTEM_PROMPT,
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = narrationDirectionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const narrationDeliveryNotes = parsed.data.deliveryNotes.trim() || null;
  const narrationSpeed = parsed.data.speed ?? null;
  await prisma.scene.update({ where: { id: sceneId }, data: { narrationDeliveryNotes, narrationSpeed } });

  return { narrationDeliveryNotes, narrationSpeed };
}

// ── Dialogue lines — ordered, per-Character spoken lines within a Scene,
// each with its own audio takes via Asset.dialogueLineId. ────────────────

const DIALOGUE_LINE_INCLUDE = {
  character: { select: { id: true, name: true, voiceName: true } },
  audio: { orderBy: { createdAt: "desc" as const } },
  translations: true,
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
  translations: { language: string; text: string; deliveryNotes: string | null; speed: number | null }[];
  audioGenerationStartedAt: Date | null;
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
  translations: { language: string; text: string; deliveryNotes: string | null; speed: number | null }[];
  audioGenerationStartedAt: string | null;
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
    translations: line.translations,
    audioGenerationStartedAt: line.audioGenerationStartedAt?.toISOString() ?? null,
  };
}

// Same claim/release contract as claimShotForImageGeneration in
// shot-images.ts.
export async function claimNarrationGeneration(sceneId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - STALE_MS.narration);
  const result = await prisma.scene.updateMany({
    where: { id: sceneId, OR: [{ narrationGenerationStartedAt: null }, { narrationGenerationStartedAt: { lt: staleThreshold } }] },
    data: { narrationGenerationStartedAt: new Date() },
  });
  return result.count > 0;
}

export async function releaseNarrationGeneration(sceneId: string): Promise<void> {
  await prisma.scene.update({ where: { id: sceneId }, data: { narrationGenerationStartedAt: null } });
}

export async function claimDialogueAudioGeneration(dialogueLineId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - STALE_MS.dialogueAudio);
  const result = await prisma.dialogueLine.updateMany({
    where: { id: dialogueLineId, OR: [{ audioGenerationStartedAt: null }, { audioGenerationStartedAt: { lt: staleThreshold } }] },
    data: { audioGenerationStartedAt: new Date() },
  });
  return result.count > 0;
}

export async function releaseDialogueAudioGeneration(dialogueLineId: string): Promise<void> {
  await prisma.dialogueLine.update({ where: { id: dialogueLineId }, data: { audioGenerationStartedAt: null } });
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

When a "# Director's emotional arc" section is present, it reflects decisions already made for this scene's shots — keep your delivery direction consistent with that arc rather than inventing a contradictory one, but use your own judgment for anything it doesn't cover.

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
  const [lines, scene] = await Promise.all([
    prisma.dialogueLine.findMany({
      where: { sceneId },
      orderBy: { order: "asc" },
      include: { character: { select: { name: true } } },
    }),
    prisma.scene.findUniqueOrThrow({
      where: { id: sceneId },
      include: { shots: { orderBy: { order: "asc" }, select: { order: true, emotion: true, emotionIntensity: true } } },
    }),
  ]);
  if (lines.length === 0) {
    throw new OpenRouterError("This scene has no dialogue lines yet.");
  }

  const arcBlock = buildEmotionalArcBlock(scene.shots);
  const dialogueBlock = lines.map((l) => `${l.order}. ${l.character.name}: ${l.text}`).join("\n");
  const userPrompt = arcBlock ? `${arcBlock}\n\n# Dialogue lines\n${dialogueBlock}` : dialogueBlock;

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
  const language = scene.story?.language ?? scene.episode?.season.project.storyBible?.language ?? null;
  const style = [genre && `Genre: ${genre}`, tone && `Tone: ${tone}`].filter(Boolean).join("\n") || null;

  return { scene, style, language };
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
function buildScriptDraftSystemPrompt(characterNames: string[], language: string | null): string {
  const roster = characterNames.length > 0 ? characterNames.join(", ") : "(no characters are attached to this scene)";
  const languageLine = language
    ? `\nWrite the narration and every dialogue line in ${language} — natural, spoken ${language}, not a transliteration. Character names in "characterName" still must match the roster exactly as given (do not translate names).\n`
    : "";
  return `You are the Script Drafting step of Narrata's Voice pipeline. Given one scene's description and style context, draft the narrator's voiceover script and, if the scene calls for spoken dialogue, the dialogue lines for it.

Characters available to speak in this scene: ${roster}
Only write dialogue for characters in that exact list — never invent a new speaker or use a character not listed. If the scene needs a line from someone not on the list, leave that line out rather than misattributing it.
${languageLine}

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
  const { scene, style, language } = await loadSceneScriptContext(sceneId);

  const userPrompt = [`# Scene\n${scene.description}`, style && `# Style\n${style}`].filter(Boolean).join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: buildScriptDraftSystemPrompt(scene.characters.map((c) => c.name), language),
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
  provider,
  language,
}: {
  dialogueLineId: string;
  modelId: string;
  provider: string;
  // Dubbing — see generateNarrationAudio's `language` for the contract.
  language?: string;
}): Promise<SerializedAudioTake> {
  const line = await prisma.dialogueLine.findUniqueOrThrow({
    where: { id: dialogueLineId },
    include: { character: true },
  });

  let text: string;
  let instructions: string | undefined;
  let speed: number | undefined;
  let voiceId: string;
  if (language) {
    const translation = await getDialogueLineTranslation(dialogueLineId, language);
    if (!translation?.text?.trim()) {
      throw new ElevenLabsError(`Translate this line into ${language} before generating audio.`);
    }
    voiceId = resolveVoiceForLanguage(line.character.voicesByLanguage, language) ?? "";
    if (!voiceId) {
      throw new ElevenLabsError(
        `Set a voice for ${line.character.name} in ${language} in the Translations panel before generating dialogue audio.`
      );
    }
    text = translation.text;
    instructions = translation.deliveryNotes ?? undefined;
    speed = translation.speed ?? undefined;
  } else {
    // Always the character's assigned voice — never a per-call override — so
    // one character sounds the same in every scene of a story. No fallback
    // default: an unset voice blocks generation rather than silently reusing
    // a generic voice that two different unassigned characters would share.
    if (!line.character.voiceName?.trim()) {
      throw new ElevenLabsError(
        `Set a voice for ${line.character.name} in their Character profile before generating dialogue audio.`
      );
    }
    text = line.text;
    voiceId = line.character.voiceName;
    instructions = line.deliveryNotes ?? undefined;
    speed = line.speed ?? undefined;
  }

  const projectId = await resolveSceneProjectId(line.sceneId);
  const startedAt = Date.now();
  let generated: { base64: string; mimeType: string; costUsd?: number; wordTimestamps?: WordTimestamp[] };
  try {
    generated = await generateSpeechForProvider({
      provider,
      modelId,
      text,
      voiceId,
      sceneId: line.sceneId,
      instructions,
      speed,
      language,
    });
  } catch (error) {
    await recordGenerationEvent({
      jobType: "VOICE",
      provider,
      modelId,
      projectId,
      entityType: "DIALOGUE_LINE",
      entityId: dialogueLineId,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await recordGenerationEvent({
    jobType: "VOICE",
    provider,
    modelId,
    projectId,
    entityType: "DIALOGUE_LINE",
    entityId: dialogueLineId,
    costUsd: generated.costUsd,
    durationMs: Date.now() - startedAt,
    success: true,
  });
  const buffer = Buffer.from(generated.base64, "base64");
  const fileName = `line${language ? `-${language}` : ""}.${audioExtension(generated.mimeType)}`;
  const key = buildStorageKey("dialogue-lines", dialogueLineId, fileName);
  await storage.put(key, buffer);

  const asset = await prisma.$transaction(async (tx) => {
    await tx.asset.updateMany({
      where: { dialogueLineId, language: language ?? null, isSelected: true },
      data: { isSelected: false },
    });
    return tx.asset.create({
      data: {
        type: "AUDIO_DIALOGUE",
        storageKey: key,
        fileName,
        mimeType: generated.mimeType,
        sizeBytes: buffer.byteLength,
        dialogueLineId,
        language: language ?? null,
        isSelected: true,
        prompt: text,
        modelId,
        createdBy: "AI",
        wordTimestamps: generated.wordTimestamps ? (generated.wordTimestamps as unknown as Prisma.InputJsonValue) : undefined,
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
    // Scoped to this asset's own language — see selectNarrationAudio's
    // identical comment.
    await tx.asset.updateMany({
      where: { dialogueLineId, language: asset.language, isSelected: true },
      data: { isSelected: false },
    });
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { isSelected: true, reviewedAt: new Date() },
    });
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
    narrationGenerationStartedAt: Date | null;
  },
>(scene: T) {
  return {
    ...scene,
    narrationAudio: scene.narrationAudio.map(serializeAudioTake),
    dialogueLines: scene.dialogueLines.map(serializeDialogueLine),
    narrationGenerationStartedAt: scene.narrationGenerationStartedAt?.toISOString() ?? null,
  };
}
