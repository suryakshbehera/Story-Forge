import { prisma } from "@/lib/db";

// India's 22 scheduled languages, plus English since most of this app's UI
// and AI prompting defaults to it. Kept as a plain string list (not a schema
// enum) — Story.language/StoryBible.language stay free-text columns, so a
// project can still be set to a language outside this list if needed.
export const INDIAN_LANGUAGES = [
  "English",
  "Hindi",
  "Bengali",
  "Marathi",
  "Telugu",
  "Tamil",
  "Gujarati",
  "Urdu",
  "Kannada",
  "Odia",
  "Malayalam",
  "Punjabi",
  "Assamese",
  "Maithili",
  "Sanskrit",
  "Konkani",
  "Nepali",
  "Sindhi",
  "Dogri",
  "Kashmiri",
  "Bodo",
  "Santali",
  "Manipuri (Meitei)",
];

// Sarvam AI's TTS (lib/ai/sarvam.ts) only covers 11 of the above — this maps
// the free-text Story.language/StoryBible.language value to the BCP-47-ish
// code its API requires on every call. Confirmed against Sarvam's own API
// reference 2026-08-18. Returns null for a language Sarvam doesn't support
// (or an unset/unrecognized value) — callers must treat that as "pick a
// different Voice provider for this project," not silently fall back to a
// default language that wouldn't match the actual narration/dialogue text.
const SARVAM_LANGUAGE_CODES: Record<string, string> = {
  English: "en-IN",
  Hindi: "hi-IN",
  Bengali: "bn-IN",
  Marathi: "mr-IN",
  Telugu: "te-IN",
  Tamil: "ta-IN",
  Gujarati: "gu-IN",
  Kannada: "kn-IN",
  Odia: "od-IN",
  Malayalam: "ml-IN",
  Punjabi: "pa-IN",
};

export function sarvamLanguageCode(language: string | null | undefined): string | null {
  if (!language) return null;
  return SARVAM_LANGUAGE_CODES[language.trim()] ?? null;
}

// Per-model set of INDIAN_LANGUAGES entries ElevenLabs does NOT support for
// TTS, confirmed against ElevenLabs' own model docs 2026-09-15
// (elevenlabs.io/docs/models) — scoped to this app's actual language-picker
// domain (language-select.tsx only offers INDIAN_LANGUAGES), not every
// language ElevenLabs' docs mention. A modelId with no entry here is
// unverified, not assumed unsupported — permissive by default, same
// "don't guess" reasoning as everywhere else in this file, rather than
// blocking a model whose coverage hasn't actually been checked.
const ELEVENLABS_UNSUPPORTED_LANGUAGES: Record<string, Set<string>> = {
  // eleven_multilingual_v2 (this app's seeded VOICE default, seed.ts) only
  // covers English/Hindi/Tamil of the 22 Indian languages.
  eleven_multilingual_v2: new Set(INDIAN_LANGUAGES.filter((l) => !["English", "Hindi", "Tamil"].includes(l))),
  // eleven_v3 covers most Indic languages but still not these — no Odia
  // language code exists in ElevenLabs' v3 docs at all (same gap that
  // motivated adding Sarvam as a second Voice provider in the first place).
  eleven_v3: new Set(["Odia", "Maithili", "Sanskrit", "Konkani", "Dogri", "Kashmiri", "Bodo", "Santali", "Manipuri (Meitei)"]),
};

// Callers must treat `false` as "pick a different Voice model/provider for
// this project," same contract as sarvamLanguageCode returning null — see
// lib/voice.ts's generateSpeechForProvider. Unset language returns true
// (permissive): ElevenLabs needs no explicit language code (it infers from
// voice+text), so a project with no language set keeps working exactly as
// it did before this check existed.
export function elevenLabsLanguageSupported(modelId: string, language: string | null | undefined): boolean {
  if (!language) return true;
  const unsupported = ELEVENLABS_UNSUPPORTED_LANGUAGES[modelId];
  if (!unsupported) return true;
  return !unsupported.has(language.trim());
}

// Story.language lives on Story for Single Video projects, StoryBible.language
// for Series — never both. Centralizes the "check Story first, then
// StoryBible" fallback lib/voice.ts's resolveSceneLanguage already applies,
// for the handful of server pages that need a project's language without a
// specific Scene in hand.
export function resolveProjectLanguage(project: {
  story?: { language: string | null } | null;
  storyBible?: { language: string | null } | null;
}): string | null {
  return project.story?.language ?? project.storyBible?.language ?? null;
}

// Scene-scoped version of resolveProjectLanguage above, for callers (voice
// generation, translation) that only have a sceneId. Moved here from
// lib/voice.ts (2026-09-15) so lib/localization.ts can reuse it too without
// a circular import (localization.ts is imported BY voice.ts) — confirmed
// live 2026-08-18: narration for an Odia-language project is genuine Odia
// script, i.e. this really is the language the text was written in, not
// just a display label.
export async function resolveSceneLanguage(sceneId: string): Promise<string | null> {
  const scene = await prisma.scene.findUniqueOrThrow({
    where: { id: sceneId },
    include: {
      story: true,
      episode: { include: { season: { include: { project: { include: { storyBible: true } } } } } },
    },
  });
  return scene.story?.language ?? scene.episode?.season.project.storyBible?.language ?? null;
}
