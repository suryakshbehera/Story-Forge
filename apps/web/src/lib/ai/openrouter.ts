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
}: ChatModelParams): Promise<string> {
  const apiKey = requireApiKey();

  const userContent =
    images && images.length > 0
      ? [
          { type: "text", text: userPrompt },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
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
export async function generateSpeech({ modelId, text, voice = "alloy" }: GenerateSpeechParams): Promise<GeneratedSpeech> {
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
        ? { frame_images: [{ type: "image_url", image_url: { url: imageDataUri }, frame_type: "first_frame" }] }
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
// result back from `message.audio.data`). No `voice` param here — that's a
// TTS/persona concept and doesn't apply to music/SFX generation. This is the
// least-confirmed primitive in this file (no dedicated-endpoint doc page to
// point at) — if a specific model's provider expects a different request
// shape, this is the first place to adjust.
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
      audio: { format: "mp3" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter audio request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const audio = data?.choices?.[0]?.message?.audio;
  if (!audio?.data) {
    throw new OpenRouterError("OpenRouter returned no audio data.");
  }

  return { base64: audio.data, mimeType: "audio/mpeg" };
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
