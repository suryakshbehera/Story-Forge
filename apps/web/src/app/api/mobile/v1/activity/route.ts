import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActivityForUser } from "@/lib/read/activity";

// Not in proxy.ts's RESOLVERS — projectId (when given) is a query param, not
// a path segment, and every lib/read/activity.ts query already scopes to
// `ownedProjectsWhere(user)` ANDed with that id, so an unowned projectId
// just yields empty results rather than leaking anything, same reasoning as
// GET /api/mobile/v1/projects. See mobile-technical-plan-2026-09.md §1.6.
export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const activity = await getActivityForUser(currentUser, projectId);
  return NextResponse.json(activity);
}
