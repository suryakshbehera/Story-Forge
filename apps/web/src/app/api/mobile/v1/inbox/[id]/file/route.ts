import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { fileCaptureItem, CaptureError } from "@/lib/inbox";

const fileSchema = z.object({
  target: z.object({
    type: z.enum(["character", "location", "projectStyle", "scene"]),
    id: z.string().min(1),
  }),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = fileSchema.parse(await req.json());

  try {
    await fileCaptureItem(currentUser.id, id, body.target, currentUser.role);
  } catch (error) {
    if (error instanceof CaptureError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
