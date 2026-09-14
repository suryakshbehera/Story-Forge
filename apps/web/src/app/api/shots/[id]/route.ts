import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SHOT_INCLUDE, mapShotImages, resequenceShots } from "@/lib/shots";
import { CAMERA_MOVEMENTS } from "@/lib/video-model-config";

const patchSchema = z.object({
  description: z.string().min(1).optional(),
  cameraMovement: z.enum(CAMERA_MOVEMENTS).optional(),
  durationSeconds: z.number().int().positive().optional().nullable(),
  videoModelId: z.string().optional().nullable(),
  continuityNotes: z.string().optional().nullable(),
  // Director AI cinematography (see schema.prisma). Unlike the AI ingest path
  // in lib/shots.ts — which parses leniently because a hallucinated value
  // shouldn't sink a whole scene's plan — these come from our own dropdowns,
  // so a bad value here is a bug worth rejecting with a 4xx. null is a real,
  // meaningful value on every one of them ("Director said nothing"), distinct
  // from omitting the key, which leaves the stored value alone.
  shotSize: z
    .enum(["EXTREME_WIDE", "WIDE", "FULL", "MEDIUM", "MEDIUM_CLOSE_UP", "CLOSE_UP", "EXTREME_CLOSE_UP"])
    .optional()
    .nullable(),
  lensMm: z.number().int().min(8).max(300).optional().nullable(),
  cameraAngle: z.enum(["EYE_LEVEL", "LOW", "HIGH", "OVERHEAD", "DUTCH", "OVER_THE_SHOULDER", "POV"]).optional().nullable(),
  framing: z.enum(["SINGLE", "TWO_SHOT", "THREE_SHOT", "GROUP", "INSERT", "ESTABLISHING"]).optional().nullable(),
  depthOfField: z.enum(["SHALLOW", "MEDIUM", "DEEP"]).optional().nullable(),
  focusPoint: z.string().optional().nullable(),
  lightingStyle: z
    .enum(["NATURAL", "SOFT", "HARD", "HIGH_KEY", "LOW_KEY", "BACKLIT", "SILHOUETTE", "GOLDEN_HOUR", "MOONLIT", "PRACTICAL"])
    .optional()
    .nullable(),
  composition: z
    .enum(["CENTERED", "RULE_OF_THIRDS", "SYMMETRICAL", "LEADING_LINES", "FRAME_WITHIN_FRAME", "NEGATIVE_SPACE", "DIAGONAL"])
    .optional()
    .nullable(),
  subjectMovement: z.string().optional().nullable(),
  // Director AI emotion (see schema.prisma) — same "our own dropdowns, reject
  // a bad value" contract as the cinematography fields above.
  emotion: z
    .enum([
      "JOY",
      "LOVE",
      "HOPE",
      "PRIDE",
      "RELIEF",
      "SADNESS",
      "GRIEF",
      "LONELINESS",
      "DESPAIR",
      "NOSTALGIA",
      "ANGER",
      "RAGE",
      "FRUSTRATION",
      "RESENTMENT",
      "FEAR",
      "ANXIETY",
      "DREAD",
      "PANIC",
      "SURPRISE",
      "SHOCK",
      "AWE",
      "CONFUSION",
      "CURIOSITY",
      "SHAME",
      "GUILT",
      "JEALOUSY",
      "BETRAYAL",
      "DESIRE",
      "DETERMINATION",
      "COURAGE",
      "DEFIANCE",
      "TRIUMPH",
      "SUSPENSE",
      "CALM",
      "DOUBT",
      "EXHAUSTION",
    ])
    .optional()
    .nullable(),
  emotionIntensity: z.enum(["SUBTLE", "MODERATE", "INTENSE"]).optional().nullable(),
  facialExpression: z.string().optional().nullable(),
  bodyLanguage: z.string().optional().nullable(),
});

// Polled by the client while a persisted "Generating…" state is active (see
// ShotManager) so a reload — or another tab — can tell when a generation
// claimed by claimShotForImageGeneration actually finishes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shot = await prisma.shot.findUniqueOrThrow({ where: { id }, include: SHOT_INCLUDE });
  return NextResponse.json(mapShotImages(shot));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  // continuityNotes is normalized (trimmed, "" -> null) but only touched
  // when the client actually sent it — an omitted field must not clobber
  // the stored value. focusPoint/subjectMovement are the same kind of
  // free-text field and get the same treatment; the enum/number
  // cinematography fields pass through as-is, where undefined already means
  // "not sent" and null means "cleared".
  const { continuityNotes, focusPoint, subjectMovement, facialExpression, bodyLanguage, ...rest } = body;
  const data = {
    ...rest,
    ...(continuityNotes !== undefined ? { continuityNotes: continuityNotes?.trim() || null } : {}),
    ...(focusPoint !== undefined ? { focusPoint: focusPoint?.trim() || null } : {}),
    ...(subjectMovement !== undefined ? { subjectMovement: subjectMovement?.trim() || null } : {}),
    ...(facialExpression !== undefined ? { facialExpression: facialExpression?.trim() || null } : {}),
    ...(bodyLanguage !== undefined ? { bodyLanguage: bodyLanguage?.trim() || null } : {}),
  };

  const shot = await prisma.shot.update({
    where: { id },
    data,
    include: SHOT_INCLUDE,
  });

  return NextResponse.json(mapShotImages(shot));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const shot = await tx.shot.findUniqueOrThrow({ where: { id } });
    await tx.shot.delete({ where: { id } });
    await resequenceShots(tx, shot.sceneId);
  });

  return NextResponse.json({ ok: true });
}
