import { NextRequest, NextResponse } from "next/server";
import { getRenders } from "@/lib/read/renders";

// In proxy.ts's RESOLVERS — the existing /^\/api\/mobile\/v1\/projects\/([^/]+)/
// entry has no trailing anchor, so it already covers this nested route too.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const renders = await getRenders(id);
  return NextResponse.json(renders);
}
