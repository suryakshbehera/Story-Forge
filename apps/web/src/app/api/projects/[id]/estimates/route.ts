import { NextRequest, NextResponse } from "next/server";
import { prisma, type AiJobType } from "@/lib/db";
import { getGenerationEstimate } from "@/lib/generation-events";

// Job types that ever get a GenerationEvent row — see recordGenerationEvent
// in lib/generation-events.ts. Kept as its own list rather than importing
// the full JOB_TYPES from api/ai-models/route.ts since most of those job
// types (planning/prompting/chat calls) are deliberately not metered yet.
const ESTIMATABLE_JOB_TYPES = [
  "IMAGE_GENERATION",
  "VIDEO_GENERATION",
  "VOICE",
  "MUSIC_GENERATION",
  "SFX_GENERATION",
  "VIDEO",
] as const satisfies readonly AiJobType[];

// Backs the pre-flight cost/duration panels on the expensive generate
// actions (scene-video-panel, silent-assembly-panel, video-assembly-panel).
// The project param is only used as an access-boundary check — the estimate
// itself is deliberately global, not scoped to this project (see
// getGenerationEstimate's own comment for why).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobTypeParam = req.nextUrl.searchParams.get("jobType");
  const jobType = ESTIMATABLE_JOB_TYPES.find((jt) => jt === jobTypeParam);
  if (!jobType) {
    return NextResponse.json({ error: "jobType must be one of: " + ESTIMATABLE_JOB_TYPES.join(", ") }, { status: 400 });
  }
  const modelId = req.nextUrl.searchParams.get("modelId");

  const estimate = await getGenerationEstimate(jobType, modelId);
  return NextResponse.json(estimate);
}
