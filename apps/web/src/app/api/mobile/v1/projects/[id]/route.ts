import { NextRequest, NextResponse } from "next/server";
import { getProjectDetail } from "@/lib/read/project-detail";

// In proxy.ts's RESOLVERS (the /^\/api\/mobile\/v1\/projects\/([^/]+)/ entry)
// — ownership is already enforced before this handler runs.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectDetail(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}
