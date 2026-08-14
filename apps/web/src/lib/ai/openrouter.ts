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
  transcript?: string;
}

// VOICE routes through chat completions' audio-output modality (the
// OpenAI-compatible "gpt-audio" family the seeded VOICE default uses) rather
// than a dedicated TTS endpoint — OpenRouter has no separate /audio/speech
// route for these models. Since the underlying model is conversational, not
// a pure TTS engine, the system prompt has to explicitly pin it to reading
// the input verbatim or it may paraphrase/respond instead of narrating it.
const SPEECH_SYSTEM_PROMPT =
  "You are a text-to-speech narrator. Speak the user's message verbatim, word-for-word, exactly as written. Do not add, remove, paraphrase, or comment on any part of it, and do not respond conversationally.";

export async function generateSpeech({ modelId, text, voice = "alloy" }: GenerateSpeechParams): Promise<GeneratedSpeech> {
  const apiKey = requireApiKey();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      modalities: ["text", "audio"],
      audio: { voice, format: "wav" },
      messages: [
        { role: "system", content: SPEECH_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(`OpenRouter speech request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const audio = data?.choices?.[0]?.message?.audio;
  if (!audio?.data) {
    throw new OpenRouterError("OpenRouter returned no audio data.");
  }

  return { base64: audio.data, mimeType: "audio/wav", transcript: audio.transcript };
}
