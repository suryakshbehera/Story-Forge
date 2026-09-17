import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteCaptureItem, CaptureError } from "@/lib/inbox";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await deleteCaptureItem(currentUser.id, id);
  } catch (error) {
    if (error instanceof CaptureError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
