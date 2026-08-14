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
