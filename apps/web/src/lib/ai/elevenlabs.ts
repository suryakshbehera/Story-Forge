// Phase 10 — ElevenLabs Audio Provider. Replaces OpenRouter's workaround for
// VOICE/MUSIC_GENERATION/SFX_GENERATION (see openrouter.ts's old generateSpeech/
// generateAudio, removed) with ElevenLabs' own purpose-built endpoints. A full
// provider swap at these three call sites, not a runtime branch on
// AiModelOption.provider — that field is display-only everywhere else in this
// codebase too (e.g. VIDEO's "local"/"ffmpeg" row), so adding branching logic
// here would be new, unrequested infrastructure.
//
// Character.voiceName / Project.narratorVoiceName now hold ElevenLabs voice
// IDs (e.g. "21m00Tcm4TlvDq8ikWAM") instead of OpenAI-compatible voice names
// like "alloy" — no schema change, just a change in what the free-text field
// is expected to contain (same reasoning schema.prisma already gives for why
// it's free text and not an enum).
//
// Every endpoint below confirmed against ElevenLabs' API reference
// 2026-08-17: POST /v1/text-to-speech/{voice_id}, POST /v1/sound-generation,
// POST /v1/music — all three take `output_format` as a query parameter (not a
// body field, despite superficially similar docs layout) and authenticate via
// the `xi-api-key` header.

export class ElevenLabsError extends Error {}

function requireApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new ElevenLabsError(
      "ELEVENLABS_API_KEY is not set. Add it to apps/web/.env.local to run AI generation."
    );
  }
  return apiKey;
}

// Mirrors openrouter.ts's fetchWithTimeout — every call below aborts after a
// generous but finite budget instead of leaving a "Generating…" spinner stuck
// forever on a stalled upstream, and unwraps Node's generic "fetch failed"
// into an actionable message when the real cause is DNS/connection-level.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ElevenLabsError(`ElevenLabs request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code) {
      throw new ElevenLabsError(
        `Couldn't reach ElevenLabs (${cause.code}) — check the internet connection on the machine running this server and try again.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Requested explicitly for TTS/SFX (both confirmed to accept this value);
// left unset for Music, whose "auto" default differs by model (music_v2
// defaults to a higher sample rate) — safer not to force a value there. The
// actual response Content-Type is trusted either way rather than assumed, in
// case a provider/model combination ever returns something else.
const OUTPUT_FORMAT = "mp3_44100_128";

async function readAudioResponse(response: Response, context: string): Promise<{ base64: string; mimeType: string }> {
  if (!response.ok) {
    const body = await response.text();
    throw new ElevenLabsError(`ElevenLabs ${context} request failed (${response.status}): ${body}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new ElevenLabsError(`ElevenLabs returned no audio data for ${context}.`);
  }
  const contentType = response.headers.get("content-type");
  const mimeType = contentType && contentType.startsWith("audio/") ? contentType.split(";")[0].trim() : "audio/mpeg";
  return { base64: buffer.toString("base64"), mimeType };
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  gender: string | null;
  accent: string | null;
  language: string | null;
}

// GET /v1/voices — confirmed live 2026-09-11: top-level `{ voices: [...] }`,
// each entry carrying `voice_id`/`name`/`preview_url` plus a `labels` object
// (gender/accent/language/use_case/age/descriptive, all optional/inconsistent
// across voices — premade ElevenLabs voices have them, custom/cloned voices
// may not).
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const apiKey = requireApiKey();
  const response = await fetchWithTimeout(
    "https://api.elevenlabs.io/v1/voices",
    { headers: { "xi-api-key": apiKey } },
    15_000
  );
  if (!response.ok) {
    const body = await response.text();
    throw new ElevenLabsError(`ElevenLabs list-voices request failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  const voices: unknown[] = Array.isArray(data?.voices) ? data.voices : [];
  return voices.map((v) => {
    const voice = v as Record<string, unknown>;
    const labels = (voice.labels as Record<string, string> | undefined) ?? {};
    return {
      voiceId: String(voice.voice_id ?? ""),
      name: String(voice.name ?? "Unnamed voice"),
      category: typeof voice.category === "string" ? voice.category : null,
      description: typeof voice.description === "string" ? voice.description : null,
      previewUrl: typeof voice.preview_url === "string" ? voice.preview_url : null,
      gender: labels.gender ?? null,
      accent: labels.accent ?? null,
      language: labels.language ?? null,
    };
  });
}

export interface GenerateSpeechParams {
  modelId: string; // ElevenLabs model id, e.g. "eleven_multilingual_v2"
  text: string;
  voiceId: string; // Character.voiceName / Project.narratorVoiceName
  // Phase 8's DialogueLine.deliveryNotes, carried over from the old
  // OpenAI-compatible primitive. ElevenLabs has no equivalent free-text
  // "instructions" param — see styleFromInstructions() below for the mapping.
  instructions?: string;
  speed?: number; // voice_settings.speed, 0.7-1.2. Ignored by the eleven_v3 model.
}

export interface GeneratedSpeech {
  base64: string;
  mimeType: string;
}

export interface WordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface GeneratedSpeechWithTimestamps extends GeneratedSpeech {
  wordTimestamps: WordTimestamp[];
}

// deliveryNotes is free-text delivery direction (e.g. "anxious, quiet,
// hesitant pauses"). ElevenLabs' closest equivalent is voice_settings.style,
// a 0-1 "exaggeration" knob, not a free-text field — there's no real
// translation from prose to that single number. Any non-empty note nudges
// style up from ElevenLabs' own default (0) to a fixed 0.5 rather than
// attempting to parse/summarize the text. This is the least-confirmed part of
// this integration — the honest fix, if it matters in practice, is switching
// to the eleven_v3 model's inline audio-tag prompting (bracketed direction
// embedded in the text itself), which is a bigger change than a param tweak.
function styleFromInstructions(instructions?: string): number | undefined {
  return instructions?.trim() ? 0.5 : undefined;
}

// VOICE — ElevenLabs' Text-to-Speech-with-timestamps endpoint. Used for every
// TTS call (narration and dialogue) instead of the plain /text-to-speech
// endpoint — same request shape and cost, per ElevenLabs' docs, so there's no
// reason to keep both. Confirmed against ElevenLabs' API reference 2026-09-14: POST
// /v1/text-to-speech/{voice_id}/with-timestamps takes the identical request
// body/query params as the plain endpoint, but its response is JSON —
// { audio_base64, alignment: { characters, character_start_times_seconds,
// character_end_times_seconds }, normalized_alignment } — not a raw audio
// body, so it can't reuse readAudioResponse above. `alignment` (not
// `normalized_alignment`) is used since it corresponds to the original text
// passed in, not ElevenLabs' internal normalized form. Timestamps are
// per-character only — there's no word-level option — so
// wordsFromCharacterAlignment aggregates them by splitting on whitespace.
export async function generateSpeechWithTimestamps({
  modelId,
  text,
  voiceId,
  instructions,
  speed,
}: GenerateSpeechParams): Promise<GeneratedSpeechWithTimestamps> {
  const apiKey = requireApiKey();

  const voiceSettings: Record<string, number> = {};
  const style = styleFromInstructions(instructions);
  if (style !== undefined) voiceSettings.style = style;
  if (speed !== undefined) voiceSettings.speed = speed;

  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
      }),
    },
    60_000
  );

  if (!response.ok) {
    const body = await response.text();
    throw new ElevenLabsError(`ElevenLabs text-to-speech-with-timestamps request failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  const audioBase64 = typeof data?.audio_base64 === "string" ? data.audio_base64 : null;
  if (!audioBase64) {
    throw new ElevenLabsError("ElevenLabs returned no audio data for text-to-speech-with-timestamps.");
  }

  return {
    base64: audioBase64,
    mimeType: "audio/mpeg",
    wordTimestamps: wordsFromCharacterAlignment(data?.alignment),
  };
}

function wordsFromCharacterAlignment(alignment: unknown): WordTimestamp[] {
  if (!alignment || typeof alignment !== "object") return [];
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment as Record<string, unknown>;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(character_start_times_seconds) ||
    !Array.isArray(character_end_times_seconds)
  ) {
    return [];
  }

  const words: WordTimestamp[] = [];
  let current: { chars: string[]; start: number } | null = null;
  for (let i = 0; i < characters.length; i++) {
    const char = String(characters[i]);
    if (/\s/.test(char)) {
      if (current) {
        words.push({ word: current.chars.join(""), startSeconds: current.start, endSeconds: Number(character_end_times_seconds[i - 1]) });
        current = null;
      }
      continue;
    }
    if (!current) current = { chars: [], start: Number(character_start_times_seconds[i]) };
    current.chars.push(char);
    if (i === characters.length - 1) {
      words.push({ word: current.chars.join(""), startSeconds: current.start, endSeconds: Number(character_end_times_seconds[i]) });
    }
  }
  return words;
}

export interface GenerateSoundEffectParams {
  modelId?: string; // e.g. "eleven_text_to_sound_v2" — optional, ElevenLabs defaults if omitted
  prompt: string;
  durationSeconds?: number; // clamped to ElevenLabs' 0.5-30s range
}

export interface GeneratedSoundEffect {
  base64: string;
  mimeType: string;
}

// SFX_GENERATION — ElevenLabs' Sound Effects endpoint.
export async function generateSoundEffect({
  modelId,
  prompt,
  durationSeconds,
}: GenerateSoundEffectParams): Promise<GeneratedSoundEffect> {
  const apiKey = requireApiKey();

  const clampedDuration = durationSeconds !== undefined ? Math.min(30, Math.max(0.5, durationSeconds)) : undefined;

  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/sound-generation?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: prompt,
        ...(modelId ? { model_id: modelId } : {}),
        ...(clampedDuration !== undefined ? { duration_seconds: clampedDuration } : {}),
      }),
    },
    60_000
  );

  return readAudioResponse(response, "sound effect");
}

export interface GenerateMusicParams {
  prompt: string;
  durationSeconds?: number; // clamped to ElevenLabs' 3-600s range
}

export interface GeneratedMusic {
  base64: string;
  mimeType: string;
}

// MUSIC_GENERATION — ElevenLabs' Music endpoint. Always requests music_v2
// (the current model — "always pass music_v2 unless the caller explicitly
// needs the legacy model," per ElevenLabs' own docs) rather than reading
// modelId from the AiModelOption row: unlike TTS/SFX, the compose endpoint's
// model_id only distinguishes v1 vs v2, not a meaningful catalog choice, so
// AiModelOption.modelId for this job type is display-only (seeded as
// "music_v2" to match).
export async function generateMusic({ prompt, durationSeconds }: GenerateMusicParams): Promise<GeneratedMusic> {
  const apiKey = requireApiKey();

  const musicLengthMs = durationSeconds !== undefined ? Math.round(Math.min(600, Math.max(3, durationSeconds)) * 1000) : undefined;

  const response = await fetchWithTimeout(
    "https://api.elevenlabs.io/v1/music",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        model_id: "music_v2",
        ...(musicLengthMs !== undefined ? { music_length_ms: musicLengthMs } : {}),
      }),
    },
    180_000
  );

  return readAudioResponse(response, "music");
}
