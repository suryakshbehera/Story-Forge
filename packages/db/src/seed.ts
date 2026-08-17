import { PrismaClient, AiJobType } from "@prisma/client";

const prisma = new PrismaClient();

// Defaults reflect the job → model table decided for StoryOS V1. Every value
// here is just seed data for the AiModelOption registry — nothing in
// application code hardcodes a model id. Change or add rows any time via
// Settings → AI Models.
const defaultModels: Array<{
  jobType: AiJobType;
  provider: string;
  modelId: string;
  displayName: string;
}> = [
  { jobType: "MASTER_AI", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "STORY_WRITING", provider: "openrouter", modelId: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { jobType: "SCENE_PLANNING", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "IMAGE_PROMPTS", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "IMAGE_GENERATION", provider: "openrouter", modelId: "openai/gpt-5.4-image-2", displayName: "GPT-5.4 Image 2" },
  { jobType: "IMAGE_VALIDATION", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "VOICE", provider: "elevenlabs", modelId: "eleven_multilingual_v2", displayName: "Eleven Multilingual v2" },
  { jobType: "VIDEO_GENERATION", provider: "openrouter", modelId: "google/veo-3.1", displayName: "Veo 3.1" },
  { jobType: "VIDEO", provider: "local", modelId: "ffmpeg", displayName: "FFmpeg (local render)" },
  { jobType: "AUDIO_PLANNING", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "MUSIC_GENERATION", provider: "elevenlabs", modelId: "music_v2", displayName: "Eleven Music v2" },
  { jobType: "SFX_GENERATION", provider: "elevenlabs", modelId: "eleven_text_to_sound_v2", displayName: "Eleven Sound Effects v2" },
  { jobType: "SHOT_PLANNING", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "DIALOGUE_DIRECTION", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "SCRIPT_DRAFTING", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "STORY_CHAT", provider: "openrouter", modelId: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { jobType: "STORY_INGESTION", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "BLUEPRINT_PLANNING", provider: "openrouter", modelId: "openai/gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { jobType: "MOTION_PROMPT_DRAFTING", provider: "openrouter", modelId: "google/gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
];

// Phase 10 — these three job types moved fully off OpenRouter onto
// ElevenLabs (see apps/web/src/lib/ai/elevenlabs.ts). Re-seeding demotes any
// pre-existing default for them (typically the old OpenRouter row) rather
// than deleting it, so Settings → AI Models doesn't end up with two
// isDefault rows silently tie-breaking on display name — the old row stays
// selectable if the user ever wants to switch back.
const REPLACED_JOB_TYPES: AiJobType[] = ["VOICE", "MUSIC_GENERATION", "SFX_GENERATION"];

async function main() {
  for (const model of defaultModels) {
    const existing = await prisma.aiModelOption.findFirst({
      where: { jobType: model.jobType, modelId: model.modelId },
    });

    if (existing) {
      continue;
    }

    if (REPLACED_JOB_TYPES.includes(model.jobType) && model.provider === "elevenlabs") {
      await prisma.aiModelOption.updateMany({
        where: { jobType: model.jobType, isDefault: true },
        data: { isDefault: false },
      });
    }

    await prisma.aiModelOption.create({
      data: {
        jobType: model.jobType,
        provider: model.provider,
        modelId: model.modelId,
        displayName: model.displayName,
        isDefault: true,
        isEnabled: true,
      },
    });
  }

  console.log(`Seeded ${defaultModels.length} AI model options (existing rows left untouched).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
