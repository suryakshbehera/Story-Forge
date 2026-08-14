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
