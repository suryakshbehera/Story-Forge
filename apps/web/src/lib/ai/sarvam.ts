// Sarvam AI's Text-to-Speech API (POST /text-to-speech) — added alongside
// elevenlabs.ts as a second VOICE provider because ElevenLabs' TTS models
// don't cover Odia (or several other Indic languages this app's Story/
// StoryBible.language field can be set to) — confirmed against ElevenLabs'
// own language docs 2026-08-18. Sarvam is purpose-built for Indic languages
// (bn/en/gu/hi/kn/ml/mr/od/pa/ta/te), so a project set to one of those can
// pick a Sarvam voice per Character/Narrator instead. See
// apps/web/src/lib/voice.ts for the provider dispatch and
// apps/web/src/lib/languages.ts for the language-name → Sarvam language_code
// mapping. Confirmed against Sarvam's own API reference 2026-08-18:
// auth via the `api-subscription-key` header (not `Authorization: Bearer`,
// unlike every other provider in this app), response is JSON with base64
// audio (not raw bytes, unlike ElevenLabs/OpenRouter).

export class SarvamError extends Error {}

function requireApiKey(): string {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new SarvamError("SARVAM_API_KEY is not set. Add it to apps/web/.env.local to run AI generation.");
  }
  return apiKey;
}

// Mirrors elevenlabs.ts/openrouter.ts's fetchWithTimeout — see those for why.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SarvamError(`Sarvam request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code) {
      throw new SarvamError(
        `Couldn't reach Sarvam (${cause.code}) — check the internet connection on the machine running this server and try again.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface GenerateSpeechParams {
  modelId: string; // "bulbul:v3" or "bulbul:v2"
  text: string;
  voiceId: string; // Sarvam speaker name, e.g. "shubh" — Character.voiceName / Project.narratorVoiceName
  // BCP-47-ish code Sarvam requires on every call (e.g. "od-IN") — resolved
  // from Story.language/StoryBible.language by the caller (voice.ts), not
  // accepted as free text here, so it can't drift from what the narration/
  // dialogue text was actually written in.
  languageCode: string;
  speed?: number; // maps to `pace` (bulbul:v3 valid range 0.5-2.0) — not clamped, same as elevenlabs.ts's speed passthrough
}

export interface GeneratedSpeech {
  base64: string;
  mimeType: string;
}

export async function generateSpeech({ modelId, text, voiceId, languageCode, speed }: GenerateSpeechParams): Promise<GeneratedSpeech> {
  const apiKey = requireApiKey();

  const response = await fetchWithTimeout(
    "https://api.sarvam.ai/text-to-speech",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        text,
        language_code: languageCode,
        speaker: voiceId,
        model: modelId,
        output_audio_codec: "mp3",
        ...(speed !== undefined ? { pace: speed } : {}),
      }),
    },
    60_000
  );

  if (!response.ok) {
    const body = await response.text();
    throw new SarvamError(`Sarvam text-to-speech request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const audio = data?.audios?.[0];
  if (typeof audio !== "string" || audio.length === 0) {
    throw new SarvamError("Sarvam returned no audio data.");
  }

  return { base64: audio, mimeType: "audio/mpeg" };
}
