import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  const projects = await prisma.project.findMany({
    where: user!.role === "ADMIN" ? {} : { ownerId: user!.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { characters: true, locations: true, seasons: true } },
    },
  });
  return NextResponse.json(projects);
}

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["SINGLE", "SERIES"]),
  premise: z.string().optional(),
  genre: z.string().optional(),
  duration: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const body = createSchema.parse(await req.json());
  const intent = { premise: body.premise || undefined, genre: body.genre || undefined };

  const project = await prisma.project.create({
    data: {
      name: body.name,
      type: body.type,
      ownerId: user!.id,
      // duration has no equivalent field on StoryBible (that's
      // SeriesBlueprint.runtimeTarget, a separate model created lazily
      // elsewhere) — only carried through for SINGLE.
      ...(body.type === "SINGLE"
        ? { story: { create: { ...intent, duration: body.duration || undefined } } }
        : { storyBible: { create: intent } }),
    },
    include: { story: true, storyBible: true },
  });

  return NextResponse.json(project, { status: 201 });
}
