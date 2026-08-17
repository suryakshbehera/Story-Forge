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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        ...(history ?? []),
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OpenRouterError("OpenRouter returned an empty response.");
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

  const response = await fetch("https://openrouter.ai/api/v1/images", {
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
  });

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

export interface GenerateSpeechParams {
  modelId: string;
  text: string;
  // Provider-specific voice name (e.g. "alloy") — not a fixed enum here for
  // the same reason Character.voiceName isn't one; see schema.prisma.
  voice?: string;
  // Phase 8 — delivery direction (DialogueLine.deliveryNotes) and pace
  // (DialogueLine.speed). Both are real, documented OpenAI-compatible TTS
  // params (`instructions`, `speed` on /audio/speech), not a guessed
  // mechanism — lower-risk than generateAudio() below.
  instructions?: string;
  speed?: number;
}

export interface GeneratedSpeech {
  base64: string;
  mimeType: string;
}

// VOICE goes through OpenRouter's dedicated TTS API (POST /api/v1/audio/speech,
// OpenAI Audio Speech-compatible) rather than chat completions — same reasoning
// as generateImage() above: a separate endpoint, not a "modalities" flag on
// callChatModel. Returns raw audio bytes directly (not JSON) on success.
//
// Always requests response_format="pcm" rather than "mp3" — OpenRouter's docs
// list "pcm" as this endpoint's own default, and in practice some providers
// (confirmed: Gemini TTS) reject "mp3" outright with a 400. "pcm" is the
// lowest-common-denominator format every provider on this endpoint accepts.
// The tradeoff is that PCM comes back headerless, so it's wrapped in a
// standard WAV header before storage/playback — see wrapPcmAsWav().
export async function generateSpeech({
  modelId,
  text,
  voice = "alloy",
  instructions,
  speed,
}: GenerateSpeechParams): Promise<GeneratedSpeech> {
  const apiKey = requireApiKey();

  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: text,
      voice,
      response_format: "pcm",
      ...(instructions ? { instructions } : {}),
      ...(speed ? { speed } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter speech request failed (${response.status}): ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new OpenRouterError("OpenRouter returned no audio data.");
  }

  return { base64: wrapPcmAsWav(buffer).toString("base64"), mimeType: "audio/wav" };
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
}

export interface GeneratedVideo {
  base64: string;
  mimeType: string;
}

// VIDEO_GENERATION goes through OpenRouter's dedicated video API
// (POST /api/v1/videos) — a third separate endpoint alongside generateImage
// and generateSpeech above. Unlike those two, video generation is
// asynchronous: submitting returns a job id/status immediately, and the
// actual clip is retrieved by polling GET /api/v1/videos/{id} until the job
// reaches a terminal status, then downloading from the returned URL.
async function pollVideoJob(jobId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`https://openrouter.ai/api/v1/videos/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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
}: GenerateVideoParams): Promise<GeneratedVideo> {
  const apiKey = requireApiKey();

  const submitResponse = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      ...(durationSeconds ? { duration: durationSeconds } : {}),
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
  });

  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new OpenRouterError(`OpenRouter video request failed (${submitResponse.status}): ${body}`);
  }

  const submitted = await submitResponse.json();
  const downloadUrl = await pollVideoJob(submitted.id, apiKey);

  const contentResponse = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
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

export interface GenerateAudioParams {
  modelId: string;
  prompt: string;
  durationSeconds?: number;
}

export interface GeneratedAudio {
  base64: string;
  mimeType: string;
}

// MUSIC_GENERATION / SFX_GENERATION. Unlike generateImage/generateSpeech/
// generateVideo above, OpenRouter has no dedicated endpoint for music/SFX
// generation — confirmed against its docs: the only dedicated endpoints are
// /audio/speech (TTS), /audio/transcriptions (STT), /images, and /videos.
// OpenRouter's own docs describe every other modality, including audio
// output from models like Google Lyria or OpenAI's GPT Audio, as running
// through /chat/completions and differing only by content type/modalities —
// the same OpenAI-compatible "modalities": ["text","audio"] shape used by
// audio-output chat models generally (request an `audio.format`, read the
// result back from `message.audio.data`). This is the least-confirmed
// primitive in this file (no dedicated-endpoint doc page to point at) — if a
// specific model's provider expects a different request shape, this is the
// first place to adjust.
//
// Confirmed 2026-08-15 against a live key: OpenRouter rejects a non-streaming
// audio-output request with 400 "Audio output requires stream: true" for at
// least some providers. So this always streams (SSE) and reassembles the
// audio from `choices[0].delta.audio.data` chunks rather than reading a
// single `message.audio.data` blob off a non-streaming response.
//
// Also confirmed same day: OpenAI's audio-output endpoint requires
// `audio.voice` even for non-speech content (music/SFX) — it's a required
// param of the shared multimodal endpoint, not a TTS-only concept as
// originally assumed. Defaulted to "alloy" since music/SFX prompts don't
// carry a voice choice of their own.
//
// Also confirmed same day: OpenAI rejects `audio.format: "mp3"` when
// stream=true ("does not support 'mp3' ... Supported values are: 'pcm16'").
// So this requests "pcm16" and wraps the raw PCM in a WAV header via
// wrapPcmAsWav() below (same 24kHz/16-bit/mono assumption already used for
// generateSpeech's PCM output) instead of returning MP3 bytes directly.
export async function generateAudio({ modelId, prompt, durationSeconds }: GenerateAudioParams): Promise<GeneratedAudio> {
  const apiKey = requireApiKey();

  const userPrompt = durationSeconds ? `${prompt}\n\n(Target length: approximately ${durationSeconds} seconds.)` : prompt;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      modalities: ["text", "audio"],
      audio: { format: "pcm16", voice: "alloy" },
      stream: true,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter audio request failed (${response.status}): ${body}`);
  }
  if (!response.body) {
    throw new OpenRouterError("OpenRouter audio request returned no response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let audioBase64 = "";
  let transcript = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;

      let chunk: unknown;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = (chunk as { choices?: Array<{ delta?: { audio?: { data?: string; transcript?: string } } }> })
        ?.choices?.[0]?.delta;
      if (delta?.audio?.data) audioBase64 += delta.audio.data;
      if (delta?.audio?.transcript) transcript += delta.audio.transcript;
    }
  }

  if (!audioBase64) {
    throw new OpenRouterError(`OpenRouter returned no audio data.${transcript ? ` (transcript: ${transcript})` : ""}`);
  }

  const pcm = Buffer.from(audioBase64, "base64");
  return { base64: wrapPcmAsWav(pcm).toString("base64"), mimeType: "audio/wav" };
}

// Headerless 16-bit signed little-endian PCM at 24kHz mono — confirmed for
// Gemini TTS and the de facto standard most speech-only PCM APIs (OpenAI's
// realtime audio included) use for this endpoint's "pcm" format. Wraps it in
// a standard 44-byte WAV header so browsers can play it via <audio>.
function wrapPcmAsWav(pcm: Buffer, sampleRate = 24000, bitsPerSample = 16, channels = 1): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
