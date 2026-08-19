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
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.create({
    data: {
      name: body.name,
      type: body.type,
      ownerId: user!.id,
      ...(body.type === "SINGLE" ? { story: { create: {} } } : { storyBible: { create: {} } }),
    },
    include: { story: true, storyBible: true },
  });

  return NextResponse.json(project, { status: 201 });
}
