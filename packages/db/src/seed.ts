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
  { jobType: "VOICE", provider: "openrouter", modelId: "mistralai/voxtral-mini-tts-2603", displayName: "Voxtral Mini TTS" },
  { jobType: "VIDEO_GENERATION", provider: "openrouter", modelId: "google/veo-3.1", displayName: "Veo 3.1" },
  { jobType: "VIDEO", provider: "local", modelId: "ffmpeg", displayName: "FFmpeg (local render)" },
];

async function main() {
  for (const model of defaultModels) {
    const existing = await prisma.aiModelOption.findFirst({
      where: { jobType: model.jobType, modelId: model.modelId },
    });

    if (existing) {
      continue;
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
