import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, type AiJobType } from "@/lib/db";

const JOB_TYPES = [
  "MASTER_AI",
  "STORY_WRITING",
  "SCENE_PLANNING",
  "IMAGE_PROMPTS",
  "IMAGE_GENERATION",
  "IMAGE_VALIDATION",
  "VOICE",
  "VIDEO_GENERATION",
  "VIDEO",
  "AUDIO_PLANNING",
  "MUSIC_GENERATION",
  "SFX_GENERATION",
  "SHOT_PLANNING",
  "DIALOGUE_DIRECTION",
  "SCRIPT_DRAFTING",
] as const satisfies readonly AiJobType[];

export async function GET(req: NextRequest) {
  const jobTypeParam = req.nextUrl.searchParams.get("jobType");
  const enabledOnly = req.nextUrl.searchParams.get("enabledOnly") === "true";
  const jobType = JOB_TYPES.find((jt) => jt === jobTypeParam);

  const models = await prisma.aiModelOption.findMany({
    where: {
      ...(jobType ? { jobType } : {}),
      ...(enabledOnly ? { isEnabled: true } : {}),
    },
    orderBy: [{ jobType: "asc" }, { isDefault: "desc" }, { displayName: "asc" }],
  });
  return NextResponse.json(models);
}

const createSchema = z.object({
  jobType: z.enum(JOB_TYPES),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  isDefault: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = createSchema.parse(await req.json());

  const model = await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.aiModelOption.updateMany({
        where: { jobType: body.jobType, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.aiModelOption.create({
      data: {
        jobType: body.jobType,
        provider: body.provider,
        modelId: body.modelId,
        displayName: body.displayName,
        isDefault: body.isDefault ?? false,
        isEnabled: body.isEnabled ?? true,
      },
    });
  });

  return NextResponse.json(model, { status: 201 });
}
