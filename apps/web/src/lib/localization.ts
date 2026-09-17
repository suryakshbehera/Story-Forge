import { z } from "zod";
import { prisma, type Prisma } from "@/lib/db";
import { callChatModel, OpenRouterError } from "@/lib/ai/openrouter";
import { resolveSceneLanguage } from "@/lib/languages";

// ─────────────────────────────────────────────────────────────────────────
// Dubbing — translates a Story/Episode's scenes into a language other than
// the one it was written in (Story.language/StoryBible.language), so the
// same visuals can carry multiple language audio tracks. Deliberately
// layered on top of the existing single-language pipeline rather than
// replacing it: SceneTranslation/DialogueLineTranslation only ever hold the
// *other* languages (see schema.prisma) — a project with no dubs has zero
// rows here, and lib/voice.ts's primary-language path is untouched. See
// [[per-shot-pair video and silent assembly]]'s silent/audio split for why
// the export side (video-assembly.ts) can reuse the real assembly pipeline
// per language instead of a from-scratch dub renderer.
// ─────────────────────────────────────────────────────────────────────────

// Character.voicesByLanguage / Project.narratorVoicesByLanguage — a small
// {language: voiceId} map, Json? rather than a relation table for the same
// "free text, changes over time, not something SQL ever filters/joins on"
// reasoning voiceName/narratorVoiceName themselves already have.
export function resolveVoiceForLanguage(voicesByLanguage: Prisma.JsonValue | null | undefined, language: string): string | null {
  if (!voicesByLanguage || typeof voicesByLanguage !== "object" || Array.isArray(voicesByLanguage)) return null;
  const value = (voicesByLanguage as Record<string, unknown>)[language];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Sets (or clears) one {language: voiceId} entry in Character.voicesByLanguage
// / Project.narratorVoicesByLanguage as a single atomic UPDATE — jsonb_set/
// the `-` remove operator, not a read-then-merge-then-write from app code.
// That read-merge-write shape was tried first and had a real lost-update
// race: two PATCHes for the same character setting two *different*
// languages' voices close together (e.g. two browser tabs, or the
// Translations panel's language switch firing two saves back to back) could
// interleave — the second request reads the map before the first's write
// lands, so its merge is computed from stale data and silently clobbers the
// first language's just-saved entry. jsonb_set/`-` run inside Postgres
// itself, so there's no read step to race.
export async function setVoiceForLanguage(
  model: "character" | "project",
  id: string,
  language: string,
  voiceId: string | null
): Promise<void> {
  const table = model === "character" ? "characters" : "projects";
  const column = model === "character" ? "voicesByLanguage" : "narratorVoicesByLanguage";
  const trimmed = voiceId?.trim() || null;
  if (trimmed) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = jsonb_set(coalesce("${column}", '{}'::jsonb), ARRAY[$1]::text[], to_jsonb($2::text), true) WHERE id = $3`,
      language,
      trimmed,
      id
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = coalesce("${column}", '{}'::jsonb) - $1 WHERE id = $2`,
      language,
      id
    );
  }
}

export interface SerializedSceneTranslation {
  language: string;
  narration: string | null;
  narrationDeliveryNotes: string | null;
  narrationSpeed: number | null;
}

export interface SerializedDialogueLineTranslation {
  language: string;
  text: string;
  deliveryNotes: string | null;
  speed: number | null;
}

// Read helpers for lib/voice.ts's dub audio-generation path — a missing row
// (never translated, or translated then the scene edited so it needs
// retranslating) is null, treated the same as "no narration written yet" is
// for the primary language: generation is blocked with a clear error rather
// than silently generating nothing/garbage.
export async function getSceneTranslation(sceneId: string, language: string): Promise<SerializedSceneTranslation | null> {
  const row = await prisma.sceneTranslation.findUnique({ where: { sceneId_language: { sceneId, language } } });
  if (!row) return null;
  return {
    language: row.language,
    narration: row.narration,
    narrationDeliveryNotes: row.narrationDeliveryNotes,
    narrationSpeed: row.narrationSpeed,
  };
}

export async function getDialogueLineTranslation(
  dialogueLineId: string,
  language: string
): Promise<SerializedDialogueLineTranslation | null> {
  const row = await prisma.dialogueLineTranslation.findUnique({
    where: { dialogueLineId_language: { dialogueLineId, language } },
  });
  if (!row) return null;
  return { language: row.language, text: row.text, deliveryNotes: row.deliveryNotes, speed: row.speed };
}

export async function updateSceneTranslation(
  sceneId: string,
  language: string,
  fields: { narration?: string | null; narrationDeliveryNotes?: string | null; narrationSpeed?: number | null }
): Promise<SerializedSceneTranslation> {
  const row = await prisma.sceneTranslation.upsert({
    where: { sceneId_language: { sceneId, language } },
    create: { sceneId, language, ...fields },
    update: fields,
  });
  return {
    language: row.language,
    narration: row.narration,
    narrationDeliveryNotes: row.narrationDeliveryNotes,
    narrationSpeed: row.narrationSpeed,
  };
}

export async function updateDialogueLineTranslation(
  dialogueLineId: string,
  language: string,
  fields: { text?: string; deliveryNotes?: string | null; speed?: number | null }
): Promise<SerializedDialogueLineTranslation> {
  // text is required on create (no default) — a manual edit that adds a
  // translation for a line with none yet must supply it; deliveryNotes/speed
  // alone can't create a row (there'd be nothing to speak).
  const row = await prisma.dialogueLineTranslation.upsert({
    where: { dialogueLineId_language: { dialogueLineId, language } },
    create: { dialogueLineId, language, text: fields.text ?? "", deliveryNotes: fields.deliveryNotes, speed: fields.speed },
    update: fields,
  });
  return { language: row.language, text: row.text, deliveryNotes: row.deliveryNotes, speed: row.speed };
}

// ── TRANSLATION — AI-drafted, then user-editable via update*Translation
// above, same "AI proposes, user can overwrite" idiom as SCRIPT_DRAFTING one
// concern over. One call per scene (not per line) so a conversation's
// register stays coherent, same reasoning DIALOGUE_DIRECTION already gives
// for batching a whole scene at once. ──────────────────────────────────────

const translationResponseSchema = z.object({
  narration: z.string(),
  dialogueLines: z.array(z.object({ order: z.number().int(), text: z.string() })),
});

// Requires strict JSON output (see openrouter.ts jsonMode) — the word "JSON"
// appears below to satisfy the provider's json_object requirement.
function buildTranslationSystemPrompt(targetLanguage: string): string {
  return `You are the Translation step of Narrata's Dubbing pipeline. Translate the given scene's narration and dialogue lines into natural, spoken ${targetLanguage} — how a native speaker would actually say it aloud, not a literal or transliterated translation.

When a line's text mentions a character's name, keep that name exactly as given — never translate or transliterate a proper name.

Respond with strict JSON only — no prose, no markdown code fences. The JSON must match this shape exactly:
{
  "narration": "translated narration script, or an empty string if the original had none",
  "dialogueLines": [
    { "order": 1, "text": "translated line, matching the same order number from the input" }
  ]
}
Include every dialogue line's order number from the input, even ones with short translations.`;
}

export async function translateSceneScript({
  sceneId,
  language,
  modelId,
}: {
  sceneId: string;
  language: string;
  modelId: string;
}): Promise<{ scene: SerializedSceneTranslation; dialogueLines: (SerializedDialogueLineTranslation & { dialogueLineId: string })[] }> {
  const primaryLanguage = await resolveSceneLanguage(sceneId);
  if (primaryLanguage && primaryLanguage.trim().toLowerCase() === language.trim().toLowerCase()) {
    throw new OpenRouterError(
      `"${language}" is this Story/Series' own language, not a dub — pick a different target language.`
    );
  }

  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: { dialogueLines: { orderBy: { order: "asc" }, include: { character: { select: { name: true } } } } },
  });
  if (!scene.narration?.trim() && scene.dialogueLines.length === 0) {
    throw new OpenRouterError("This scene has no narration or dialogue to translate yet.");
  }

  const narrationBlock = scene.narration?.trim() ? `# Narration\n${scene.narration}` : null;
  const dialogueBlock =
    scene.dialogueLines.length > 0
      ? `# Dialogue\n${scene.dialogueLines.map((l) => `${l.order}. ${l.character.name}: ${l.text}`).join("\n")}`
      : null;
  const userPrompt = [narrationBlock, dialogueBlock].filter(Boolean).join("\n\n");

  const raw = await callChatModel({
    modelId,
    systemPrompt: buildTranslationSystemPrompt(language),
    userPrompt,
    jsonMode: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("AI returned invalid JSON.");
  }
  const parsed = translationResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OpenRouterError("AI returned an unexpected shape.");
  }

  const narration = parsed.data.narration.trim() || null;
  const sceneTranslation = await updateSceneTranslation(sceneId, language, { narration });

  // Independent per-line upserts (different dialogueLineId each, no shared
  // state) — parallelized rather than awaited one at a time in a loop.
  // Unlike translations-panel.tsx's "Translate all scenes" loop (one real AI
  // call per scene, deliberately sequential so a mid-run failure doesn't
  // lose already-translated scenes and the user sees live per-scene
  // progress), these are plain DB writes with no such tradeoff.
  const byOrder = new Map(parsed.data.dialogueLines.map((l) => [l.order, l.text]));
  const dialogueLines = (
    await Promise.all(
      scene.dialogueLines.map(async (line) => {
        const text = byOrder.get(line.order);
        if (text === undefined) return null;
        const translation = await updateDialogueLineTranslation(line.id, language, { text });
        return { ...translation, dialogueLineId: line.id };
      })
    )
  ).filter((l): l is SerializedDialogueLineTranslation & { dialogueLineId: string } => l !== null);

  return { scene: sceneTranslation, dialogueLines };
}
