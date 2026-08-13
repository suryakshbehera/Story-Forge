import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const locations = await prisma.location.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: { referenceImages: true },
  });
  return NextResponse.json(locations);
}

const createSchema = z.object({
  name: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = createSchema.parse(await req.json());

  const location = await prisma.location.create({
    data: { projectId, name: body.name },
  });

  return NextResponse.json(location, { status: 201 });
}
