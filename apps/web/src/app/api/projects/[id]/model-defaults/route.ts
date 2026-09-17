import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, type AiJobType } from "@/lib/db";

// Same job-type roster as /api/ai-models — the ones actually used by a
// ModelSelect somewhere, not every AiJobType enum value (MASTER_AI et al.
// stay global-default-only for now).
const JOB_TYPES = [
  "STORY_WRITING",
  "SCENE_PLANNING",
  "SHOT_PLANNING",
  "IMAGE_PROMPTS",
  "IMAGE_GENERATION",
  "IMAGE_VALIDATION",
  "SCRIPT_DRAFTING",
  "NARRATION_DIRECTION",
  "DIALOGUE_DIRECTION",
  "VOICE",
  "MOTION_PROMPT_DRAFTING",
  "DURATION_RECOMMENDATION",
  "VIDEO_GENERATION",
  "VIDEO_VALIDATION",
  "MUSIC_GENERATION",
  "SFX_GENERATION",
  "AUDIO_CUE_PLANNING",
  "AUDIO_MIXING_PLANNING",
  "VIDEO",
  "TRANSLATION",
] as const satisfies readonly AiJobType[];

export { JOB_TYPES };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const rows = await prisma.projectModelDefault.findMany({
    where: { projectId },
    include: { aiModelOption: true },
  });
  return NextResponse.json(rows);
}

const putSchema = z.object({
  jobType: z.enum(JOB_TYPES),
  aiModelOptionId: z.string().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = putSchema.parse(await req.json());

  if (body.aiModelOptionId === null) {
    // Explicit "use the global default" — remove any project override.
    await prisma.projectModelDefault.deleteMany({ where: { projectId, jobType: body.jobType } });
    return NextResponse.json({ ok: true });
  }

  const row = await prisma.projectModelDefault.upsert({
    where: { projectId_jobType: { projectId, jobType: body.jobType } },
    create: { projectId, jobType: body.jobType, aiModelOptionId: body.aiModelOptionId },
    update: { aiModelOptionId: body.aiModelOptionId },
    include: { aiModelOption: true },
  });
  return NextResponse.json(row);
}
