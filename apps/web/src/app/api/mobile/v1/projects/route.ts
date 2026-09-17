import { NextResponse } from "next/server";
import type { ProjectsResponse } from "contract";
import { getCurrentUser } from "@/lib/auth";
import { getProjectSummaries } from "@/lib/read/project-summaries";

// Not in proxy.ts's RESOLVERS — a list endpoint, same reasoning as GET
// /api/projects: proxy can't do row-level filtering on a list, so the
// handler itself scopes by ownerId (getProjectSummaries does this).
export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await getProjectSummaries(currentUser);
  const response: ProjectsResponse = { projects };
  return NextResponse.json(response);
}
