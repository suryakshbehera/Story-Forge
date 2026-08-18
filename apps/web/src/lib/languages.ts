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
