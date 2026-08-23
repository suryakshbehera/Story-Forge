export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatModelParams {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  // Requests OpenAI-compatible JSON mode. The word "JSON" must appear
  // somewhere in the prompt content or the provider rejects the request —
  // callers must ensure their system/user prompt satisfies this.
  jsonMode?: boolean;
  // Data URIs (e.g. "data:image/png;base64,...") attached to the user
  // message as image_url content parts — for vision calls like
  // IMAGE_VALIDATION comparing a generated image against reference images.
  images?: string[];
  // Data URIs (e.g. "data:video/mp4;base64,...") attached to the user
  // message as video_url content parts — OpenRouter's Video Inputs API,
  // confirmed via docs (Phase 11 planning note) but first actually used by
  // MOTION_PROMPT_DRAFTING (see draftMotionPrompt in lib/scene-video.ts).
  // Only providers/models with video-understanding support (e.g. Gemini 2.5
  // Pro/Flash) accept this — pick one via the job's AiModelOption.
  videos?: string[];
  // Prior turns, inserted between the system prompt and the final
  // userPrompt — for multi-turn callers like the Story Chat surface. Every
  // other job in this file is single-shot and omits this.
  history?: ChatMessage[];
  // Structured Outputs (OpenAI-compatible `json_schema` response_format,
  // passed through by OpenRouter for supporting models) — stronger than
  // jsonMode's `json_object`: json_object only guarantees syntactically
  // valid JSON, not that keys land at the right nesting level. Use this
  // instead of jsonMode when the response has a specific multi-field shape
  // the caller will destructure (e.g. story-ingestion.ts's flat top-level
  // story/characters/locations) — a model that's merely told the shape in
  // prose can (and, per the STORY_INGESTION bug this was added for,
  // sometimes does) close an object one brace too late and silently nest
  // later sibling keys one level deeper, where zod's lenient parsing then
  // drops them instead of erroring. Mutually exclusive with jsonMode; when
  // set, jsonMode is ignored.
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export class OpenRouterError extends Error {}

function requireApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(
      "OPENROUTER_API_KEY is not set. Add it to apps/web/.env.local to run AI generation."
    );
  }
  return apiKey;
}

// None of the calls below had a timeout — a stalled upstream provider (no
// response, no error) left the client's "Generating…" spinner stuck forever
// with no way to recover short of a page reload. Every OpenRouter fetch now
// aborts after a generous but finite budget so a stall surfaces as a clear
// OpenRouterError instead.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterError(`OpenRouter request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    // Node's fetch (undici) reports DNS/connection failures as a generic
    // "TypeError: fetch failed", with the real reason on `.cause` (e.g.
    // ENOTFOUND when DNS can't resolve openrouter.ai, ECONNRESET/ECONNREFUSED
    // for a dropped/refused connection). Left as-is this isn't an
    // OpenRouterError, so it would skip every route handler's `if (error
    // instanceof OpenRouterError) return 502` branch and surface as an
    // opaque, unhandled 500 instead — wrapping it here turns a real network
    // hiccup on the server's own connection into a plain, actionable message.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code) {
      throw new OpenRouterError(
        `Couldn't reach OpenRouter (${cause.code}) — check the internet connection on the machine running this server and try again.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// The one reusable AI-call primitive for this phase — every text generation
// job (story writing, scene planning, image prompts/validation, etc.) routes
// through here with a different modelId pulled from the AiModelOption
// registry. Never hardcode a model id at a call site.
export async function callChatModel({
  modelId,
  systemPrompt,
  userPrompt,
  temperature = 0.8,
  jsonMode = false,
  images,
  videos,
  history,
  jsonSchema,
}: ChatModelParams): Promise<string> {
  const apiKey = requireApiKey();

  const hasAttachments = (images && images.length > 0) || (videos && videos.length > 0);
  const userContent = hasAttachments
    ? [
        { type: "text", text: userPrompt },
        ...(images ?? []).map((url) => ({ type: "image_url", image_url: { url } })),
        ...(videos ?? []).map((url) => ({ type: "video_url", video_url: { url } })),
      ]
    : userPrompt;

  const response = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        temperature,
        ...(jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
              },
            }
          : jsonMode
            ? { response_format: { type: "json_object" } }
            : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...(history ?? []),
          { role: "user", content: userContent },
        ],
      }),
    },
    120_000
  );

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    // Surface whatever OpenRouter/the upstream provider did say — a bare
    // "empty response" message gave no way to tell a genuine model refusal
    // (e.g. finish_reason "content_filter"/"length") apart from a transient
    // provider hiccup without re-reading server logs by hand.
    const finishReason = data?.choices?.[0]?.finish_reason;
    const detail = [finishReason && `finish_reason: ${finishReason}`, data?.error && `error: ${JSON.stringify(data.error)}`]
      .filter(Boolean)
      .join(", ");
    throw new OpenRouterError(`OpenRouter returned an empty response.${detail ? ` (${detail})` : ""}`);
  }

  return content;
}

export interface GenerateImageParams {
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  // Locked character/location reference images (data URIs) to condition
  // generation on — OpenRouter's image-to-image reference input, confirmed
  // shape per OpenRouterTeam/skills' openrouter-images edit.ts.
  inputReferences?: string[];
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

// IMAGE_GENERATION goes through OpenRouter's dedicated Image API
// (POST /api/v1/images) rather than chat completions — a separate endpoint,
// not a "modalities" flag on callChatModel.
export async function generateImage({
  modelId,
  prompt,
  aspectRatio = "16:9",
  inputReferences,
}: GenerateImageParams): Promise<GeneratedImage> {
  const apiKey = requireApiKey();

  const response = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/images",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        aspect_ratio: aspectRatio,
        ...(inputReferences && inputReferences.length > 0
          ? { input_references: inputReferences.map((url) => ({ type: "image_url", image_url: { url } })) }
          : {}),
      }),
    },
    180_000
  );

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter image request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const image = data?.data?.[0];
  if (!image?.b64_json) {
    throw new OpenRouterError("OpenRouter returned no image data.");
  }

  return { base64: image.b64_json, mimeType: image.media_type ?? "image/png" };
}

export interface GenerateVideoParams {
  modelId: string;
  prompt: string;
  // Data URI ("data:image/png;base64,...") of the starting frame — OpenRouter
  // passes image inputs through verbatim as data URIs for this endpoint too
  // (same policy as the image adapter), no server-side fetching of a
  // publicly reachable URL required. Omitted entirely for TEXT_TO_VIDEO
  // scenes, which have no source image to seed the first frame with.
  imageDataUri?: string;
  // Phase 8 — the scene's last shot's image, given as a `last_frame`
  // continuity anchor alongside imageDataUri's `first_frame` when a scene
  // has more than one shot (confirmed real via OpenRouter's docs: frame_type
  // accepts "first_frame"/"last_frame", model-dependent support — Veo 3.1,
  // the seeded default, supports both). Omitted for single-shot scenes.
  lastFrameDataUri?: string;
  durationSeconds?: number;
  // Native audio generation toggle — OpenRouter's confirmed `generate_audio`
  // field (defaults true for models that support it upstream, so this is
  // sent explicitly rather than omitted whenever the caller has an opinion).
  generateAudio?: boolean;
  // e.g. "480p"/"720p" — model-dependent, omitted when the caller has no
  // preference so the provider's own default applies.
  resolution?: string;
}

export interface GeneratedVideo {
  base64: string;
  mimeType: string;
}

// VIDEO_GENERATION goes through OpenRouter's dedicated video API
// (POST /api/v1/videos) — a separate endpoint alongside generateImage above.
// Unlike that one, video generation is asynchronous: submitting returns a job
// id/status immediately, and the actual clip is retrieved by polling
// GET /api/v1/videos/{id} until the job reaches a terminal status, then
// downloading from the returned URL.
async function pollVideoJob(jobId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(
      `https://openrouter.ai/api/v1/videos/${jobId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      20_000
    );
    if (!response.ok) {
      const body = await response.text();
      throw new OpenRouterError(`OpenRouter video status check failed (${response.status}): ${body}`);
    }
    const data = await response.json();
    if (data.status === "completed") {
      const url = data.unsigned_urls?.[0];
      if (!url) throw new OpenRouterError("OpenRouter reported the video job complete but returned no download URL.");
      return url;
    }
    if (data.status === "failed") {
      throw new OpenRouterError("OpenRouter video generation job failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new OpenRouterError("Timed out waiting for OpenRouter video generation to finish.");
}

export async function generateVideo({
  modelId,
  prompt,
  imageDataUri,
  lastFrameDataUri,
  durationSeconds,
  generateAudio,
  resolution,
}: GenerateVideoParams): Promise<GeneratedVideo> {
  const apiKey = requireApiKey();

  const submitResponse = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/videos",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        ...(durationSeconds ? { duration: durationSeconds } : {}),
        ...(generateAudio !== undefined ? { generate_audio: generateAudio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(imageDataUri
          ? {
              frame_images: [
                { type: "image_url", image_url: { url: imageDataUri }, frame_type: "first_frame" },
                ...(lastFrameDataUri
                  ? [{ type: "image_url", image_url: { url: lastFrameDataUri }, frame_type: "last_frame" }]
                  : []),
              ],
            }
          : {}),
      }),
    },
    60_000
  );

  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new OpenRouterError(`OpenRouter video request failed (${submitResponse.status}): ${body}`);
  }

  const submitted = await submitResponse.json();
  const downloadUrl = await pollVideoJob(submitted.id, apiKey);

  const contentResponse = await fetchWithTimeout(
    downloadUrl,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    60_000
  );
  if (!contentResponse.ok) {
    throw new OpenRouterError(`OpenRouter video download failed (${contentResponse.status}).`);
  }
  const buffer = Buffer.from(await contentResponse.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new OpenRouterError("OpenRouter returned an empty video file.");
  }
  const mimeType = contentResponse.headers.get("content-type") ?? "video/mp4";

  return { base64: buffer.toString("base64"), mimeType };
}

// generateAudio (MUSIC_GENERATION/SFX_GENERATION) used to live here too — see
// apps/web/src/lib/ai/elevenlabs.ts. Phase 10 moved those two job types off
// this file's old chat-completions workaround onto ElevenLabs' purpose-built
// endpoints; that specific workaround is gone for good. VOICE's generateSpeech
// below is unrelated to it: OpenRouter has an actual documented POST
// /api/v1/audio/speech endpoint (OpenAI-compatible, confirmed via
// openrouter.ai/docs 2026-08-19), so re-adding it here as a third VOICE
// provider alongside ElevenLabs/Sarvam isn't reviving the old workaround.
//
// generateAudioClip below (added 2026-08-21) is a third, separate thing: a
// real OpenRouter provider option for MUSIC_GENERATION/SFX_GENERATION,
// alongside ElevenLabs (see lib/scene-audio.ts's per-provider dispatch,
// mirroring VOICE's). OpenRouter still has no dedicated music/SFX REST
// endpoint (confirmed against its docs 2026-08-21 — only /images, /videos,
// /audio/speech, /audio/transcriptions are dedicated), but non-speech
// audio-generating models like Google's Lyria 3 (google/lyria-3-pro-preview)
// go through the same chat-completions "audio output" mechanism documented
// for TTS-via-chat: modalities: ["text","audio"], streamed. Confirmed via
// OpenRouter's own multimodal/audio guide example.

export interface GenerateAudioClipParams {
  modelId: string; // OpenRouter model slug for a non-speech audio-generating model, e.g. "google/lyria-3-pro-preview"
  prompt: string;
}

export interface GeneratedAudioClip {
  base64: string;
  mimeType: string;
}

// Request shape here is NOT fresh guesswork — this same chat-completions
// audio-output mechanism was built, then deleted wholesale in Phase 10 when
// MUSIC_GENERATION/SFX_GENERATION moved to ElevenLabs (see this file's
// generateSpeech below for the unrelated dedicated-endpoint VOICE path). Two
// quirks were confirmed live against a real key before that deletion and are
// reapplied here rather than rediscovered by trial and error:
//   - `stream: true` is mandatory — a non-streaming request 400s with "Audio
//     output requires stream: true" (at least for some upstream providers).
//   - `audio.voice` is required even for non-speech content — omitting it
//     404/400s. It has no meaning for a music model like Lyria, so this just
//     sends the same "alloy" placeholder confirmed to work, not a real
//     creative choice.
//   - `audio.format: "mp3"` was rejected once streaming ("Supported values
//     are: 'pcm16'"), so this requests pcm16 and wraps the result in a WAV
//     header via wrapPcmAsWav (below) — same 24kHz/16-bit/mono assumption
//     generateSpeech's own PCM fallback uses, since a streamed response has no
//     `audio/pcm;rate=...` Content-Type to read real values from.
// No duration parameter: nothing in this request shape has one, and Lyria's
// flat per-song/per-clip pricing suggests length isn't a caller-controlled
// dial for this model regardless.
//
// Response is Server-Sent Events, not plain JSON: each `data: ` line is a
// chunk whose next audio slice lives at choices[0].delta.audio.data (base64),
// concatenated below into one clip before a single final decode — matching
// OpenRouter's own documented client example, not decoded chunk-by-chunk.
export async function generateAudioClip({ modelId, prompt }: GenerateAudioClipParams): Promise<GeneratedAudioClip> {
  const apiKey = requireApiKey();

  const response = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        modalities: ["text", "audio"],
        audio: { voice: "alloy", format: "pcm16" },
        stream: true,
      }),
    },
    60_000
  );

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter audio generation request failed (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice("data: ".length).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: { choices?: Array<{ delta?: { audio?: { data?: string } } }> };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const audioChunk = parsed.choices?.[0]?.delta?.audio?.data;
      if (audioChunk) chunks.push(audioChunk);
    }
  }

  if (chunks.length === 0) {
    throw new OpenRouterError("OpenRouter returned no audio data.");
  }

  const pcm = Buffer.from(chunks.join(""), "base64");
  return { base64: wrapPcmAsWav(pcm, 24000, 1).toString("base64"), mimeType: "audio/wav" };
}

export interface GenerateSpeechParams {
  modelId: string; // OpenRouter TTS model slug, e.g. "openai/gpt-4o-mini-tts-2025-12-15"
  text: string;
  voiceId: string; // provider-specific voice id, e.g. "alloy" — Character.voiceName / Project.narratorVoiceName
  // Passed through as OpenRouter's provider-specific `instructions` field —
  // confirmed via OpenRouter's audio API announcement: "OpenAI's speech
  // models accept an `instructions` field for tone control." Models/providers
  // that don't support it are expected to just ignore it (same passthrough
  // behavior OpenRouter documents for other provider-specific options), so no
  // per-model branching here.
  instructions?: string;
  speed?: number; // playback multiplier, OpenRouter default 1.0
}

export interface GeneratedSpeech {
  base64: string;
  mimeType: string;
}

async function requestSpeech(
  apiKey: string,
  responseFormat: "mp3" | "pcm",
  { modelId, text, voiceId, instructions, speed }: GenerateSpeechParams
): Promise<Response> {
  return fetchWithTimeout(
    "https://openrouter.ai/api/v1/audio/speech",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: text,
        voice: voiceId,
        response_format: responseFormat,
        ...(speed !== undefined ? { speed } : {}),
        ...(instructions?.trim() ? { instructions } : {}),
      }),
    },
    60_000
  );
}

// Only mp3/pcm are documented response_format values, and support is
// per-model, not universal — confirmed live 2026-08-19: Gemini TTS models
// reject response_format=mp3 with a 400 ("Gemini TTS only supports
// response_format=pcm") while OpenAI's models accept mp3 fine. Rather than
// hardcode a per-model table, try mp3 first (matches the mp3 output
// ElevenLabs/Sarvam already produce) and fall back to pcm only on that
// specific rejection.
function isUnsupportedFormatError(status: number, body: string): boolean {
  return status === 400 && /response_format/i.test(body);
}

// Wraps raw PCM in a standard 44-byte WAV header so it's a playable file
// instead of headerless raw samples. sampleRate/channels come from the
// response's own Content-Type (OpenRouter echoes them back, e.g.
// "audio/pcm;rate=24000;channels=1" — confirmed via OpenRouter's docs
// 2026-08-19) rather than being assumed, since that varies by model; bit
// depth isn't echoed anywhere so 16-bit (the documented Gemini TTS output,
// and PCM's usual default) is assumed.
function wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample = 16): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function parsePcmContentType(contentType: string | null): { sampleRate: number; channels: number } {
  const rate = contentType?.match(/rate=(\d+)/)?.[1];
  const channels = contentType?.match(/channels=(\d+)/)?.[1];
  return { sampleRate: rate ? parseInt(rate, 10) : 24000, channels: channels ? parseInt(channels, 10) : 1 };
}

// VOICE — OpenRouter's dedicated Audio Speech API, not chat completions.
export async function generateSpeech(params: GenerateSpeechParams): Promise<GeneratedSpeech> {
  const apiKey = requireApiKey();

  let response = await requestSpeech(apiKey, "mp3", params);
  let responseFormat: "mp3" | "pcm" = "mp3";

  if (!response.ok) {
    const body = await response.text();
    if (!isUnsupportedFormatError(response.status, body)) {
      throw new OpenRouterError(`OpenRouter speech request failed (${response.status}): ${body}`);
    }
    response = await requestSpeech(apiKey, "pcm", params);
    responseFormat = "pcm";
    if (!response.ok) {
      const retryBody = await response.text();
      throw new OpenRouterError(`OpenRouter speech request failed (${response.status}): ${retryBody}`);
    }
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new OpenRouterError("OpenRouter returned no audio data.");
  }

  if (responseFormat === "pcm") {
    const { sampleRate, channels } = parsePcmContentType(response.headers.get("content-type"));
    return { base64: wrapPcmAsWav(buffer, sampleRate, channels).toString("base64"), mimeType: "audio/wav" };
  }

  const contentType = response.headers.get("content-type");
  const mimeType = contentType && contentType.startsWith("audio/") ? contentType.split(";")[0].trim() : "audio/mpeg";
  return { base64: buffer.toString("base64"), mimeType };
}
