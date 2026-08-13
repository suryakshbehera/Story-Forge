import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  provider: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const model = await prisma.$transaction(async (tx) => {
    const current = await tx.aiModelOption.findUniqueOrThrow({ where: { id } });
    if (body.isDefault) {
      await tx.aiModelOption.updateMany({
        where: { jobType: current.jobType, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.aiModelOption.update({ where: { id }, data: body });
  });

  return NextResponse.json(model);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.aiModelOption.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
